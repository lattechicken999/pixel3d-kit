# Godot 4 recipe (Forward+ renderer)

> These snippets follow the same math as the tested Three.js module, but they
> have not been run in Godot by this project yet. Verify them in the editor and
> adjust to your Godot version (4.2+ is needed for `hint_normal_roughness_texture`).

## 1. Low-res render
Two options:
- **Simplest.** Set Project Settings → Display → Window → Stretch → Mode to
  `viewport`, and Viewport Width/Height to the low resolution (e.g. 384×216).
  Set Rendering → Textures → Default Texture Filter to `Nearest`.
- **With UI at full resolution.** Put the 3D world in a `SubViewport` sized to
  the low resolution, and show it in a `SubViewportContainer` with
  `stretch = true` and `stretch_shrink = pixelSize`.

Then:
- Use a `Camera3D` with `projection = PROJECTION_ORTHOGONAL`.
- Turn MSAA and FXAA off.

## 2 + 3. Outline and crease post-process
Put a `MeshInstance3D` with a `QuadMesh` (size 2×2, `flip_faces = true`) in
front of the camera, with `extra_cull_margin = 16384`. Give it this material:

```glsl
shader_type spatial;
render_mode unshaded, depth_draw_never, depth_test_disabled;

uniform sampler2D screen_tex : hint_screen_texture, filter_nearest;
uniform sampler2D depth_tex  : hint_depth_texture, filter_nearest;
uniform sampler2D normal_tex : hint_normal_roughness_texture, filter_nearest;
uniform float outline_threshold = 0.6;
uniform float outline_darken = 0.35;
uniform float crease_threshold = 0.25;
uniform float crease_strength = 0.2;

void vertex() { POSITION = vec4(VERTEX.xy, 1.0, 1.0); }

float lin_depth(vec2 uv, mat4 inv_proj) {
  float d = texture(depth_tex, uv).r;
  vec4 v = inv_proj * vec4(uv * 2.0 - 1.0, d, 1.0);
  return -v.z / v.w;
}
vec3 nrm(vec2 uv) { return normalize(texture(normal_tex, uv).xyz * 2.0 - 1.0); }

void fragment() {
  vec2 px = 1.0 / VIEWPORT_SIZE;
  vec2 o[4] = { vec2(px.x,0), vec2(-px.x,0), vec2(0,px.y), vec2(0,-px.y) };
  float d = lin_depth(SCREEN_UV, INV_PROJECTION_MATRIX);
  vec3 n = nrm(SCREEN_UV);
  float edge = 0.0, crease = 0.0;
  for (int i = 0; i < 4; i++) {
    float dn = lin_depth(SCREEN_UV + o[i], INV_PROJECTION_MATRIX);
    edge += max(0.0, dn - d);
    vec3 nn = nrm(SCREEN_UV + o[i]);
    float nInd = clamp(dot(n - nn, normalize(vec3(1.0))), 0.0, 1.0);
    float dInd = clamp(sign((dn - d) * 0.25 + 0.0025), 0.0, 1.0);
    crease += (1.0 - dot(n, nn)) * nInd * dInd;
  }
  vec3 c = texture(screen_tex, SCREEN_UV).rgb;
  if (edge > outline_threshold) c *= outline_darken;
  else if (crease > crease_threshold) c = mix(c, vec3(1.0), crease_strength);
  ALBEDO = c;
}
```

## 4. Stepped lighting
In your object shaders:

```glsl
shader_type spatial;
uniform vec3 albedo : source_color = vec3(0.3, 0.55, 0.3);
uniform int steps = 3;
void fragment() { ALBEDO = albedo; }
void light() {
  float ndl = clamp(dot(NORMAL, LIGHT), 0.0, 1.0) * ATTENUATION;
  float band = floor(ndl * float(steps)) / float(steps - 1);
  DIFFUSE_LIGHT += mix(0.3, 1.0, clamp(band, 0.0, 1.0)) * LIGHT_COLOR / PI;
}
```

For crisp shadow edges, set DirectionalLight3D → Shadow → Blur = 0.

## 5. Light response and shadow shapes
- **Normals.** Bake edited normals in Blender with the Data Transfer modifier
  (source: a UV sphere), or apply the `sphericalize` math from
  `theory.md` with an `@tool` script.
- **Shadow proxy.** On the visible mesh, set
  `cast_shadow = SHADOW_CASTING_SETTING_OFF`. Add a child proxy mesh with
  `cast_shadow = SHADOW_CASTING_SETTING_SHADOWS_ONLY`.

## 6. Pixel snapping (GDScript on the camera rig)
```gdscript
extends Camera3D
@export var target: Node3D
@export var offset := Vector3(10, 11, 10)
var low_res_height := 216.0
func _process(_dt):
    var want := target.global_position + offset
    var pw := size / low_res_height           # ortho `size` = visible height
    var b := global_transform.basis
    var x := want.dot(b.x); var y := want.dot(b.y)
    var sx := round(x / pw) * pw; var sy := round(y / pw) * pw
    global_position = want + b.x * (sx - x) + b.y * (sy - y)
    # optional sub-pixel smoothing: shift the SubViewportContainer by
    # ((x-sx)/pw, -(y-sy)/pw) * pixel_size screen pixels.
```
Snap moving objects the same way, relative to the camera position.

## 7. Stepped rotation
```gdscript
var step := TAU / 8.0
visual.rotation.y = round(facing / step) * step
```

## 8. Sprite-like ordering
In the character's spatial shader, add this to `vertex()`. It writes clip
space only for depth:

```glsl
uniform vec3 pivot_world;   // set from script each frame
uniform float flatten_bias = 0.4;
uniform float flatten_keep = 0.1;
void vertex() {
  vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
  vec3 fwd = -INV_VIEW_MATRIX[2].xyz;
  vec3 fh = normalize(vec3(fwd.x, 0.0, fwd.z));
  float along = dot(wp - pivot_world, fh);
  vec3 flat_wp = wp - fh * (along * (1.0 - flatten_keep) + flatten_bias);
  vec4 real_clip = PROJECTION_MATRIX * VIEW_MATRIX * vec4(wp, 1.0);
  vec4 flat_clip = PROJECTION_MATRIX * VIEW_MATRIX * vec4(flat_wp, 1.0);
  POSITION = vec4(real_clip.xy, flat_clip.z / flat_clip.w * real_clip.w, real_clip.w);
}
```
