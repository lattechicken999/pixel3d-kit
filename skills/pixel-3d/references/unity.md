# Unity (URP) recipe

> **§1–4 and 6 were run in Unity 6000.2 (URP 17.2, Forward+)** on a
> top-down diorama built from Unity primitives with Unity-chan, recorded with
> Unity Recorder and checked frame by frame. The rest of this file still
> follows the Three.js math untested. A working setup lives in the demo
> project's `Assets/Pixel3DDemo/`.

> **Pick a scene made for a game camera.** The first attempt used the URP
> sample's Garden scene (built for first-person, realistic PBR textures). From
> above it read as a dark photo through a low-res filter, not a game: the
> high-frequency textures turned into pixel noise, the roof cut-away exposed
> building sections, and the effects could not fix that. Simple shapes and flat
> colours (or textures painted for the pixel size) are what this look needs.

## 1. Low-res render
- **Camera.** Render into a RenderTexture with `filterMode = Point`,
  `antiAliasing = 1`, a depth buffer and the `DefaultHDR` format.
- **Size it with a 1-pixel margin.** `inner = Screen.size / pixelSize`,
  RT size `inner + 2`, and `orthographicSize = orthoSize + pw` (one world-pixel
  above and below; the width follows the aspect). §6 uses the margin.
- **Display.** A `RawImage` on a Screen Space – Overlay canvas, with
  `uvRect = ((1 + dx) / W, (1 + dy) / H, inner.x / W, inner.y / H)` where `W, H`
  is the RT size and `dx, dy` is the §6 remainder in low-res pixels. Captions
  and HUD on the same canvas stay at full resolution.
- **Anti-aliasing.** In pixel mode set `camera.allowMSAA = false` and the URP
  camera data `antialiasing = None`.
- **Soft shadows sparkle.** Their filtering noise is fixed on the screen while
  the world scrolls in whole pixels. In pixel mode set the key light to
  `LightShadows.Hard`.

## 2 + 3. Outline and crease
Add a **Full Screen Pass Renderer Feature** to every URP Renderer the project
uses (the URP sample template has one per quality level):
- *Pass Material*: the shader below.
- *Injection Point*: After Rendering Post Processing.
- *Requirements*: Depth + Normal (URP then renders `_CameraNormalsTexture`).
- *Fetch Color Buffer*: on (the pass reads `_BlitTexture`).

From an editor script: create a `FullScreenPassRendererFeature`, set
`passMaterial`, `injectionPoint`, `requirements`, `fetchColorBuffer`,
`AddObjectToAsset` it to the `UniversalRendererData`, add it to
`rendererFeatures` and append its local file id to `m_RendererFeatureMap`.
The feature runs for every camera using that renderer, so switch the effect
with a material property (`_OutlineOn`), not by removing the feature.

```hlsl
// pixel3d-kit: outline + convex crease + light-step post-process for URP 17
// (Full Screen Pass Renderer Feature, Requirements: Depth + Normal, Fetch Color Buffer on).
// Same math as the verified Godot recipe (godot.md §2+3).
Shader "Hidden/Pixel3D/Outline"
{
    Properties
    {
        _OutlineOn ("Outline On", Float) = 1
        _OutlineThreshold ("Outline Threshold (m)", Float) = 0.5
        _OutlineDarken ("Outline Darken", Float) = 0.35
        _OutlineWidth ("Outline Width (px)", Int) = 2
        _CreaseThreshold ("Crease Threshold", Float) = 0.25
        _CreaseStrength ("Crease Strength (x brighter)", Float) = 0.5
        _ConvexEpsilon ("Convex Epsilon (m)", Float) = 0.02
        _Steps ("Light Steps (0 = off)", Float) = 0
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" }
        ZWrite Off ZTest Always Cull Off Blend Off

        Pass
        {
            Name "Pixel3DOutline"

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.core/Runtime/Utilities/Blit.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareNormalsTexture.hlsl"

            float _OutlineOn, _OutlineThreshold, _OutlineDarken, _CreaseThreshold, _CreaseStrength, _ConvexEpsilon, _Steps;
            int _OutlineWidth;

            float LinDepth(float2 uv)
            {
                uv = clamp(uv, 0.0, 1.0 - 0.5 * _ScreenSize.zw); // no outline at the frame border
                float raw = SampleSceneDepth(uv);
                if (unity_OrthoParams.w > 0.5)
                {
                    #if UNITY_REVERSED_Z
                        raw = 1.0 - raw;
                    #endif
                    return lerp(_ProjectionParams.y, _ProjectionParams.z, raw);
                }
                return LinearEyeDepth(raw, _ZBufferParams);
            }

            float3 Nrm(float2 uv) { return normalize(SampleSceneNormals(clamp(uv, 0.0, 1.0))); }

            half4 Frag(Varyings input) : SV_Target
            {
                float2 uv = input.texcoord;
                float2 px = _ScreenSize.zw;
                float3 col = SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_PointClamp, uv).rgb;

                // Light steps: quantize brightness into bands (the "stepped lighting" look,
                // applied after lighting so baked GI, probes and Shader Graph materials all get it).
                // Quantize in gamma space so dark areas keep their darkness (in linear
                // space the first band would lift every shadow to the band middle).
                if (_Steps > 0.5)
                {
                    float lum = max(dot(col, float3(0.2126, 0.7152, 0.0722)), 1e-5);
                    float g = pow(lum, 1.0 / 2.2);
                    float q = round(g * _Steps) / _Steps;
                    col *= pow(max(q, 0.5 / _Steps), 2.2) / lum;
                }

                if (_OutlineOn < 0.5)
                    return half4(col, 1);

                float2 o[4] = { float2(px.x, 0), float2(-px.x, 0), float2(0, px.y), float2(0, -px.y) };
                float d = LinDepth(uv);
                float3 n = Nrm(uv);

                // Outline centred on the silhouette: ceil(w/2) px on the near object,
                // floor(w/2) px just outside it. Both are painted in the NEAR object's
                // colour (darkened): taking the outer pixel's own colour made a two-tone,
                // background-tinted halo (dark green on grass, grey-brown on sand).
                int wIn = (_OutlineWidth + 1) / 2;
                int wOut = _OutlineWidth / 2;
                float edgeIn = 0, edgeOut = 0;
                float2 nearUV = uv;
                [unroll] for (int r = 1; r <= 2; r++)
                {
                    [unroll] for (int i = 0; i < 4; i++)
                    {
                        float2 uvn = uv + o[i] * r;
                        float dn = LinDepth(uvn);
                        if (r <= wIn) edgeIn = max(edgeIn, dn - d);
                        if (r <= wOut && d - dn > edgeOut) { edgeOut = d - dn; nearUV = uvn; }
                    }
                }

                // Crease on convex folds only (nearer than neighbours on average),
                // 8 neighbours so 2:1 stair-stepped edges get a solid line.
                float crease = 0;
                float depthSum = 0;
                [unroll] for (int k = 0; k < 4; k++)
                {
                    depthSum += LinDepth(uv + o[k]) - d;
                    depthSum += LinDepth(uv + o[k] * 2) - d;
                    crease = max(crease, 1 - dot(n, Nrm(uv + o[k])));
                }
                crease = max(crease, 1 - dot(n, Nrm(uv + float2( px.x,  px.y))));
                crease = max(crease, 1 - dot(n, Nrm(uv + float2(-px.x,  px.y))));
                crease = max(crease, 1 - dot(n, Nrm(uv + float2( px.x, -px.y))));
                crease = max(crease, 1 - dot(n, Nrm(uv + float2(-px.x, -px.y))));
                bool inside = all(uv > px * 2.5) && all(uv < 1 - px * 2.5);
                bool convex = inside && depthSum > _ConvexEpsilon;

                if (edgeIn > _OutlineThreshold)
                    col *= _OutlineDarken;
                else if (edgeOut > _OutlineThreshold)
                    col = SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_PointClamp, nearUV).rgb * _OutlineDarken;
                else if (convex && crease > _CreaseThreshold)
                    col *= 1 + _CreaseStrength;  // brighten the surface's own colour; lerp-to-white in linear
                                             // space turned dark pixels into one flat grey
                return half4(col, 1);
            }
            ENDHLSL
        }
    }
}
```

- **Paint flat details as flat geometry.** Paths built as 2 cm-thick boxes got
  an outline on one edge and a crease on the other along their whole length.
  Use quads (no side faces) for anything that should read as colour on the
  ground.
- `_OutlineThreshold` is metres of depth jump: 0.35 suited the diorama (7 m-tall
  frame). With `_OutlineWidth` 2, both outline pixels take the near object's
  colour; the outer one samples `_BlitTexture` at the neighbour in front. The
  final demo uses 1 (inner pixel only): at 320×180, 2 px made thin props such
  as a lamp post solid black.
- The crease multiplies the colour (`col *= 1 + strength`). The first version
  mixed toward white in linear space; on a night scene every crease became the
  same flat grey (measured: (98, 99, 101) on dark wood, 17 % of a railing area).
- `_Steps` (whole-frame brightness bands) is still in the shader but was
  **not** kept: it quantizes albedo and texture together with light, so detail
  and the character merged into the ground (colours in the frame dropped from
  18,100 to 4,270). Use §4 instead.

## 4. Stepped lighting (toon material)
Swap each opaque URP Lit material for this shader at runtime (copy `_BaseMap`,
`_BaseColor` and, with `_EMISSION`, `_EmissionColor`); keep transparent ones
(face overlays) as they are.

```hlsl
// pixel3d-kit: stepped lighting (kit §4) for URP 17. The main light is cut into
// bands (shadow included), ambient comes from SH; albedo and textures stay intact.
Shader "Pixel3D/Toon"
{
    Properties
    {
        _BaseMap ("Base Map", 2D) = "white" {}
        _BaseColor ("Base Color", Color) = (1, 1, 1, 1)
        _Cutoff ("Alpha Cutoff", Range(0, 1)) = 0.5
        [HDR] _EmissionColor ("Emission", Color) = (0, 0, 0, 0)
        _Steps ("Light Steps", Float) = 3
        _ShadowFloor ("Darkest Band", Range(0, 1)) = 0.35
        _AmbientStrength ("Ambient Strength", Range(0, 2)) = 1
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" "Queue" = "Geometry" }

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_instancing

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            TEXTURE2D(_BaseMap); SAMPLER(sampler_BaseMap);
            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                half _Cutoff;
                half4 _EmissionColor;
                half _Steps;
                half _ShadowFloor;
                half _AmbientStrength;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct Varyings { float4 positionCS : SV_POSITION; float3 positionWS : TEXCOORD0; float3 normalWS : TEXCOORD1; float2 uv : TEXCOORD2; UNITY_VERTEX_INPUT_INSTANCE_ID };

            Varyings Vert(Attributes v)
            {
                Varyings o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_TRANSFER_INSTANCE_ID(v, o);
                VertexPositionInputs p = GetVertexPositionInputs(v.positionOS.xyz);
                o.positionCS = p.positionCS;
                o.positionWS = p.positionWS;
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                o.uv = TRANSFORM_TEX(v.uv, _BaseMap);
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                half4 albedo = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv) * _BaseColor;
                float3 n = normalize(i.normalWS);
                Light main = GetMainLight(TransformWorldToShadowCoord(i.positionWS));
                // kit §4: ndl (with the shadow) cut into bands, darkest band kept above ~0.3
                // No distanceAttenuation: for the main light it reads unity_LightData.z, which
                // came through as 0 in this setup (Unity 6.2, Forward+) and blacked out the sun.
                half ndl = saturate(dot(n, main.direction)) * main.shadowAttenuation;
                half steps = max(_Steps, 2);
                half band = saturate(floor(ndl * steps) / (steps - 1));
                half3 direct = main.color * lerp(_ShadowFloor, 1, band);
                half3 ambient = SampleSH(n) * _AmbientStrength;
                half3 col = albedo.rgb * (direct + ambient) + _EmissionColor.rgb;
                return half4(col, 1);
            }
            ENDHLSL
        }

        // Shadows, depth and normals come from URP Lit (same property names).
        // UsePass needs the pass name in UPPER CASE, or the pass is silently missing.
        UsePass "Universal Render Pipeline/Lit/SHADOWCASTER"
        UsePass "Universal Render Pipeline/Lit/DEPTHONLY"
        UsePass "Universal Render Pipeline/Lit/DEPTHNORMALS"
    }
}
```

Two traps, both found because the shadows vanished in the toon stage:
- **`UsePass` needs the pass name in upper case** (`SHADOWCASTER`,
  `DEPTHONLY`, `DEPTHNORMALS`). With `ShadowCaster` the pass is silently
  missing: no shadows, and no normals for the crease pass.
- **Do not multiply by `mainLight.distanceAttenuation`.** It reads
  `unity_LightData.z`, which came through as 0 for this custom shader in
  Unity 6.2 / Forward+, so the sun disappeared. A directional light needs no
  distance attenuation.

On the light, set Soft Shadows to off in pixel mode.

## 5. Light response and shadow shapes
- **Normals.** Same as Godot: use Blender Data Transfer, or an editor script
  that applies the `sphericalize` math from `theory.md` to `mesh.normals`.
- **Shadow proxy.** Set the visible MeshRenderer to
  `shadowCastingMode = Off`. Set the proxy to `ShadowsOnly`.

## 6. Pixel snapping + sub-pixel scroll (C#)
```csharp
Vector2Int inner;                                   // from §1
float PixelWorldSize() => 2f * orthoSize / inner.y; // inner height, no margin

void LateUpdate() {
    Quaternion rot = Quaternion.Euler(pitch, yaw, 0);
    Vector3 r = rot * Vector3.right, u = rot * Vector3.up;
    Vector3 want = focus - rot * Vector3.forward * distance;
    Vector3 ideal = want;
    float pw = PixelWorldSize();
    float x = Vector3.Dot(want, r), y = Vector3.Dot(want, u);
    float sx = Mathf.Round(x / pw) * pw, sy = Mathf.Round(y / pw) * pw;
    want += r * (sx - x) + u * (sy - y);
    cam.transform.SetPositionAndRotation(want, rot);

    // Sub-pixel scroll: the world stays on whole pixels, the upscaled image
    // moves by the remainder. Without it the screen steps 4 px at a time and
    // zig-zags on diagonal pans, which reads as shaking.
    float W = inner.x + 2, H = inner.y + 2;
    rawImage.uvRect = new Rect((1 + (x - sx) / pw) / W, (1 + (y - sy) / pw) / H, inner.x / W, inner.y / H);

    // The followed character: snap in SCREEN space, relative to the UNSNAPPED
    // camera (`ideal` = want before the snap). Relative to the snapped camera it
    // flipped between two pixels every frame and looked like camera shake.
    // Other moving objects snap relative to the snapped camera (`want`).
    Vector3 p = root.TransformPoint(visualLocalPos);
    Vector3 rel = p - ideal;
    float cx = Vector3.Dot(rel, r), cy = Vector3.Dot(rel, u);
    visual.position = p + r * (Mathf.Round(cx / pw) * pw - cx) + u * (Mathf.Round(cy / pw) * pw - cy);
}
```

Measured on the recording (×4, 30 fps, diagonal pan): before the sub-pixel
scroll the vertical step alternated 0 / 4 screen pixels; after it, 2–3 pixels
every frame (std 0.35 px). With the character snapped in screen space its
on-screen position stopped changing at all while the camera followed it
(previously it reversed direction in 93 % of frames).

**Recording.** Unity Recorder with `CapFrameRate` keeps game time per frame
fixed. An unfocused Editor can stop ticking mid-recording
(`playerLoopTicking: false`); set `Application.runInBackground = true` and call
`EditorApplication.QueuePlayerLoopUpdate()` from `EditorApplication.update`.

**Characters with Built-in shaders** (Unity-chan and most older Asset Store
models) render pink in URP. When converting to URP Lit, read the texture with
`material.mainTexture`: with the shader missing, `HasProperty("_MainTex")`
returns false and the copy comes out untextured.

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
