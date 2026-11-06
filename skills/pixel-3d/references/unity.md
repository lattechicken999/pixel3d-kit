# Unity (URP) recipe

> These snippets follow the same math as the tested Three.js module, but they
> have not been run in Unity by this project yet. Verify them in the editor.
> Targets URP 14+ (Unity 2022.3 / Unity 6).

## 1. Low-res render
- **Camera.** Use an orthographic Camera. Set `targetTexture` to a
  RenderTexture at the low resolution (e.g. 384×216), with Filter Mode =
  Point, Anti-aliasing = None, and a depth buffer.
- **Display.** Show the RenderTexture full-screen with a `RawImage` on a
  Screen Space – Overlay canvas, or blit it to the screen camera with point
  sampling.
- **Pipeline asset.** Turn MSAA off.

## 2 + 3. Outline and crease
1. In the URP Renderer, enable **Depth Texture** and add a
   **Full Screen Pass Renderer Feature** (URP 14+).
2. Turn on its *Requirements → Normal*, which makes URP render
   `_CameraNormalsTexture`.
3. Fragment, in HLSL or a Shader Graph Custom Function:

```hlsl
#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"
#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareNormalsTexture.hlsl"

float LinDepth(float2 uv) {
    float raw = SampleSceneDepth(uv);
    // orthographic: depth is linear
    #if UNITY_REVERSED_Z
        raw = 1.0 - raw;
    #endif
    return lerp(_ProjectionParams.y, _ProjectionParams.z, raw);
}

float3 Outline(float2 uv, float3 col, float2 texel,
               float outlineTh, float darken, float creaseTh, float creaseStr)
{
    float2 o[4] = { float2(texel.x,0), float2(-texel.x,0), float2(0,texel.y), float2(0,-texel.y) };
    float d = LinDepth(uv);
    float3 n = SampleSceneNormals(uv);
    float edge = 0, crease = 0;
    [unroll] for (int i = 0; i < 4; i++) {
        float dn = LinDepth(uv + o[i]);
        edge += max(0, dn - d);
        float3 nn = SampleSceneNormals(uv + o[i]);
        float nInd = saturate(dot(n - nn, normalize(float3(1,1,1))));
        float dInd = saturate(sign((dn - d) * 0.25 + 0.0025));
        crease += (1 - dot(n, nn)) * nInd * dInd;
    }
    if (edge > outlineTh) return col * darken;
    if (crease > creaseTh) return lerp(col, 1, creaseStr);
    return col;
}
```

## 4. Stepped lighting
Use a Shader Graph Custom Function with
`GetMainLight(TransformWorldToShadowCoord(posWS))`. Then:

```
ndl  = saturate(dot(N, light.direction)) * light.shadowAttenuation
band = floor(ndl * steps) / (steps - 1)
col  = albedo * light.color * lerp(0.3, 1, saturate(band))
```

On the light, set Soft Shadows to off.

## 5. Light response and shadow shapes
- **Normals.** Same as Godot: use Blender Data Transfer, or an editor script
  that applies the `sphericalize` math from `theory.md` to `mesh.normals`.
- **Shadow proxy.** Set the visible MeshRenderer to
  `shadowCastingMode = Off`. Set the proxy to `ShadowsOnly`.

## 6. Pixel snapping (C#)
```csharp
void LateUpdate() {
    Vector3 want = target.position + offset;
    float pw = cam.orthographicSize * 2f / lowResHeight;
    Vector3 r = transform.right, u = transform.up;
    float x = Vector3.Dot(want, r), y = Vector3.Dot(want, u);
    float sx = Mathf.Round(x / pw) * pw, sy = Mathf.Round(y / pw) * pw;
    transform.position = want + r * (sx - x) + u * (sy - y);
    // optional: offset the RawImage uvRect by ((x-sx)/pw, (y-sy)/pw) / lowRes for smooth scrolling
}
```

## 7. Stepped rotation
```csharp
float step = 360f / 8f;
visual.localEulerAngles = new Vector3(0, Mathf.Round(yaw / step) * step, 0);
```

## 8. Sprite-like ordering
In the character's vertex stage, compute the clip position twice:
1. once from the real world position, for x, y and w;
2. once from the "flattened" world position, for z:
   `wp - fh * (along*(1-keep) + bias)`, where `fh` is the horizontal camera
   forward. See `theory.md` §8.

Then output `float4(real.xy, flat.z / flat.w * real.w, real.w)`.
