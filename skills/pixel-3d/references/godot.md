# Godot 4 recipe (Forward+ renderer)

> **§1–6 were run in Godot 4.7.2** on the official Platformer 3D demo
> (store.godotengine.org), recorded with Movie Maker and checked frame by frame.
> The rest of this file still follows the Three.js math untested. The shaders
> and scripts below are the ones that ran; everything needed is in this file.
> 4.2+ is needed for `hint_normal_roughness_texture`.

## 1. Low-res render
Render the 3D world into a `SubViewport` and show it with a `TextureRect`
(`texture = sub_viewport.get_texture()`, `texture_filter = NEAREST`,
`expand_mode = EXPAND_IGNORE_SIZE`, `stretch_mode = STRETCH_SCALE`). UI stays
at full resolution on a `CanvasLayer` above it.

- **Size it with a 1-pixel margin.** `inner = window_size / pixelSize`,
  `sub_viewport.size = inner + (2, 2)`, `texture_rect.size = sub_viewport.size * pixelSize`,
  `texture_rect.position = (-pixelSize, -pixelSize)`. The margin is what lets
  §6 scroll smoothly. (A `SubViewportContainer` with `stretch_shrink` cannot
  be offset by a fraction of a pixel, so it is not used.)
- Use a `Camera3D` with `projection = PROJECTION_ORTHOGONAL` and
  `size = ortho_size * (inner.y + 2) / inner.y`, so one world-pixel of margin
  sits above and below the frame.
- In pixel mode set `msaa_3d = MSAA_DISABLED` on the SubViewport.
- **Do not hard-code the low-res height.** On Windows with display scaling the
  window can open smaller than asked (1280×720 became 1152×648). Compute
  `inner` from the real window size. For a fixed recording size also set
  `display/window/size/viewport_width/height` and
  `display/window/dpi/allow_hidpi = false`.
- **Turn off screen-space noise in pixel mode.** It stays fixed on the screen
  while the world scrolls, so every pixel sparkles:
  `sub_viewport.use_debanding = false` and
  `RenderingServer.directional_soft_shadow_filter_set_quality(RenderingServer.SHADOW_QUALITY_HARD)`.

## 2 + 3. Outline and crease post-process
Put a `MeshInstance3D` with a `QuadMesh` (size 2×2, `flip_faces = true`) as a
child of the camera, with `extra_cull_margin = 16384`. Give it this material:

```glsl
shader_type spatial;
render_mode unshaded, depth_draw_never, depth_test_disabled, cull_disabled;

uniform sampler2D screen_tex : hint_screen_texture, filter_nearest;
uniform sampler2D depth_tex  : hint_depth_texture, filter_nearest;
uniform sampler2D normal_tex : hint_normal_roughness_texture, filter_nearest;
uniform float outline_threshold = 0.6;
uniform float outline_darken = 0.35;
uniform float crease_threshold = 0.25;
uniform float crease_strength = 0.35;  // x brighter
uniform float convex_epsilon = 0.02;
uniform int outline_width : hint_range(1, 3) = 2;   // outline thickness in low-res pixels

void vertex() { POSITION = vec4(VERTEX.xy, 1.0, 1.0); }

float lin_depth(vec2 uv, mat4 inv_proj) {
  uv = clamp(uv, vec2(0.0), vec2(1.0) - 0.5 / vec2(textureSize(depth_tex, 0)));  // no outline at the frame border
  float d = texture(depth_tex, uv).r;
  vec4 v = inv_proj * vec4(uv * 2.0 - 1.0, d, 1.0);
  return -v.z / v.w;
}

vec3 nrm(vec2 uv) { return normalize(texture(normal_tex, uv).xyz * 2.0 - 1.0); }

void fragment() {
  vec2 px = 1.0 / VIEWPORT_SIZE;
  vec2 o[4] = { vec2(px.x, 0.0), vec2(-px.x, 0.0), vec2(0.0, px.y), vec2(0.0, -px.y) };
  float d = lin_depth(SCREEN_UV, INV_PROJECTION_MATRIX);
  vec3 n = nrm(SCREEN_UV);

  // Outline, centred on the silhouette: ceil(w/2) px on the near object and
  // floor(w/2) px just outside it, BOTH painted in the near object's colour
  // (darkened). Using the outer pixel's own colour gave a two-tone halo tinted
  // by whatever was behind (dark green on grass, brown on paths).
  int w_in = (outline_width + 1) / 2;
  int w_out = outline_width / 2;
  float edge_in = 0.0;
  float edge_out = 0.0;
  vec2 near_uv = SCREEN_UV;
  for (int r = 1; r <= 2; r++) {
    for (int i = 0; i < 4; i++) {
      vec2 uvn = SCREEN_UV + o[i] * float(r);
      float dn = lin_depth(uvn, INV_PROJECTION_MATRIX);
      if (r <= w_in) edge_in = max(edge_in, dn - d);
      if (r <= w_out && d - dn > edge_out) { edge_out = d - dn; near_uv = uvn; }
    }
  }

  // Crease: 1-pixel highlight on convex folds only (ledge tops), never in
  // concave corners where a wall meets the floor. On a convex fold this pixel
  // is nearer than its neighbours on average; in a concave corner it is farther.
  float crease = 0.0;
  float depth_sum = 0.0;
  for (int i = 0; i < 4; i++) {
    float dn = lin_depth(SCREEN_UV + o[i], INV_PROJECTION_MATRIX);
    depth_sum += dn - d;
    depth_sum += lin_depth(SCREEN_UV + o[i] * 2.0, INV_PROJECTION_MATRIX) - d;  // 2-px ring: steadier on stair-stepped edges
    vec3 nn = nrm(SCREEN_UV + o[i]);
    crease = max(crease, 1.0 - dot(n, nn));
  }
  // Diagonal neighbours too, so 2:1 stair-stepped edges get a solid line.
  crease = max(crease, 1.0 - dot(n, nrm(SCREEN_UV + vec2( px.x,  px.y))));
  crease = max(crease, 1.0 - dot(n, nrm(SCREEN_UV + vec2(-px.x,  px.y))));
  crease = max(crease, 1.0 - dot(n, nrm(SCREEN_UV + vec2( px.x, -px.y))));
  crease = max(crease, 1.0 - dot(n, nrm(SCREEN_UV + vec2(-px.x, -px.y))));
  bool inside = all(greaterThan(SCREEN_UV, px * 2.5)) && all(lessThan(SCREEN_UV, 1.0 - px * 2.5));
  bool convex = inside && depth_sum > convex_epsilon;

  vec3 c = texture(screen_tex, SCREEN_UV).rgb;
  if (edge_in > outline_threshold) {
    c *= outline_darken;
  } else if (edge_out > outline_threshold) {
    c = texture(screen_tex, near_uv).rgb * outline_darken;
  } else if (convex && crease > crease_threshold) {
    // brighten the surface's own colour (mixing toward white in linear space
    // turns dark surfaces into one flat grey)
    c *= 1.0 + crease_strength;
  }
  ALBEDO = c;
}
```

What changed from the first version, and why (all seen in recorded frames):
- **`outline_width`.** 2 px reads better at 320×180. The line is centred on the
  silhouette (1 px on the near object, 1 px just outside it). Putting both
  pixels inside turned a 10 px-wide character solid dark.
- **Outline colour.** Both pixels take the NEAR object's colour, darkened. The
  outer pixel used to darken its own colour, so the outline became two-tone and
  took the colour of whatever was behind (dark green on grass, brown on paths).
- **Crease brightness.** The crease multiplies the surface colour
  (`c *= 1 + crease_strength`). Mixing toward white in linear space turned every
  crease on a dark surface into the same flat grey.
- **Convex-only creases.** The old one-sided bias also lit concave corners
  (where a wall meets the floor) as a broken white dotted line. Now a crease is
  drawn only where this pixel is nearer than its neighbours on average (a
  ledge top), using a 1 px and a 2 px ring for a stable sign.
- **Diagonal normals.** On 2:1 stair-stepped edges only every other pixel had a
  straight neighbour across the fold, so the highlight came out dashed.
- **Frame border.** Clamped samples at the screen edge made a stray outline
  around the whole frame.

## 4. Stepped lighting
In your object shaders, or as a replacement for each `StandardMaterial3D`
(copy `albedo_color`, `albedo_texture`, `vertex_color_use_as_albedo`,
emission and `uv1_scale/offset` into it):

```glsl
shader_type spatial;
uniform vec4 albedo : source_color = vec4(1.0);
// repeat_disable: tile atlases (GridMap stages) bleed the neighbouring tile in
// at every UV edge with wrapping, giving grid lines on floors and seams on walls.
uniform sampler2D albedo_tex : source_color, hint_default_white, filter_linear_mipmap, repeat_disable;
uniform int steps = 3;
void fragment() {
  ALBEDO = (albedo * texture(albedo_tex, UV)).rgb;
  ROUGHNESS = 1.0;
  SPECULAR = 0.0;
}
void light() {
  float ndl = clamp(dot(NORMAL, LIGHT), 0.0, 1.0) * ATTENUATION;
  float band = floor(ndl * float(steps)) / float(steps - 1);
  DIFFUSE_LIGHT += mix(0.3, 1.0, clamp(band, 0.0, 1.0)) * LIGHT_COLOR / PI;
}
```

For crisp shadow edges, set DirectionalLight3D → Shadow → Blur = 0.
GridMap tiles take their material from the MeshLibrary meshes: swap it with
`ArrayMesh.surface_set_material()` on `mesh_library.get_item_mesh(id)`.

## 5. Light response and shadow shapes
- **Normals.** Bake edited normals in Blender with the Data Transfer modifier
  (source: a UV sphere), or apply the `sphericalize` math from
  `theory.md` with an `@tool` script.
- **Shadow proxy.** On the visible mesh, set
  `cast_shadow = SHADOW_CASTING_SETTING_OFF`. Add a child proxy mesh with
  `cast_shadow = SHADOW_CASTING_SETTING_SHADOWS_ONLY`.
  Tested on the Platformer robot: its thin limbs and hollow body cast a broken
  ring at 320×180 that drifted away from the feet while it hopped. A capsule
  proxy (radius 0.32, height 1.3) on the physics body gave one clean oval.
  Also hide the demo's own `BlobShadow` decal, which stays on the body and
  doubles the shadow.

## 6. Pixel snapping + sub-pixel scroll (GDScript)
Snapping alone is not enough. The camera then moves in whole low-res pixels
(4 screen pixels at ×4), and on a diagonal pan the steps alternate between
(1, 0) and (1, 1): the whole screen zig-zags and reads as shaking. Keep the
world on the grid, and move only the upscaled image by the remainder:

```gdscript
const SHRINK := 4
var inner := Vector2i(320, 180)            # set in §1 from the window size

func pixel_world_size() -> float:
    return ortho_size / float(inner.y)     # inner height, without the margin

func _process(_dt):
    var b := cam.global_transform.basis
    var want := target.get_global_transform_interpolated().origin + b.z * distance
    var pw := pixel_world_size()
    var x := want.dot(b.x); var y := want.dot(b.y)
    var sx := roundf(x / pw) * pw; var sy := roundf(y / pw) * pw
    want += b.x * (sx - x) + b.y * (sy - y)
    cam.global_position = want
    # remainder, in screen pixels (screen y points down)
    texture_rect.position = Vector2(-SHRINK, -SHRINK) + Vector2(-(x - sx), (y - sy)) / pw * SHRINK
```

**Turn off physics interpolation on the camera** when the project has it on
(`physics/common/physics_interpolation`):
`cam.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF`.
Otherwise Godot re-interpolates a camera moved in `_process` between physics
ticks, it leaves the pixel grid, and the image offset no longer matches. Measured
on the Platformer demo: with interpolation on, the image moved 5–14 px per frame
where the camera moved a steady ~10 px; with it off, the error was 0.6 px on
average (screen-pixel rounding).

**Snap moving objects too**, or a walking character shimmers by sub-pixels
while the world stays still. Make the visual child `top_level`, turn off its
physics interpolation, and place it each frame. For the character the camera
follows, measure `rel` from the **unsnapped** camera position (`want` before
the snap); measured from the snapped camera it flips between two pixels every
frame, which reads as camera shake. Other objects use the snapped camera:

```gdscript
func snap_visual(body: Node3D, visual: Node3D, local: Transform3D):
    var b := cam.global_transform.basis
    var xf := body.get_global_transform_interpolated()
    var rel := xf.origin - ideal_cam_pos   # followed character; other objects: cam.global_position
    var pw := pixel_world_size()
    var x := rel.dot(b.x); var y := rel.dot(b.y)
    var p := xf.origin + b.x * (roundf(x / pw) * pw - x) + b.y * (roundf(y / pw) * pw - y)
    visual.global_transform = Transform3D(xf.basis, p) * local
```

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
