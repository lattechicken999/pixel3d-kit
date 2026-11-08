---
name: pixel-3d
description: Make a real-time 3D game look like hand-drawn pixel art (도트 그래픽) — the "it looks like a 2D pixel game but it's all 3D" style. Use when the user wants a 3D scene to look pixelated / retro / 도트풍 / HD-2D-like, asks for pixel outlines, toon or stepped shading, pixel-perfect camera snapping, jitter-free pixel movement, sprite-like rotation, or wants a 3D character to sort like a 2D sprite. Covers Three.js (ready-made module), Godot 4 and Unity (URP) recipes.
---

# 3D → pixel art (8 techniques)

Rendering 3D at low resolution is **not** enough on its own. It looks like a
blurry, low-res 3D game. The pixel-art feel comes from eight techniques used
together. Apply them in this order. Each one stands alone, so the user can
pick some and skip others.

| # | Technique | What it fixes | Three.js API (`assets/threejs/pixel3d.js`) |
|---|---|---|---|
| 1 | **Low-res render + nearest upscale.** Draw the scene into a small target (screen ÷ 3–6), then scale it up with no filtering. Use an **orthographic** camera. | Pixels in the first place | `new PixelRenderer(renderer, { pixelSize })` |
| 2 | **Pixel outline.** Where depth jumps, the nearer object's border pixel is darkened or recoloured. 1 px by default; a 2 px line is centred on the silhouette (1 in, 1 out) so small characters keep their interior (Godot recipe). | Shapes read like drawn sprites | `outline`, `outlineThreshold`, `outlineDarken` / `outlineColor` |
| 3 | **Lines on inner creases.** Where normals bend sharply but depth is continuous (box edges, folds), lighten or darken 1 px. Light only **convex** folds, so wall-meets-floor corners stay clean (see `theory.md` §3). | The "hand-drawn" detail inside silhouettes | `creases`, `creaseThreshold`, `creaseStrength` (+ lighten, − darken) |
| 4 | **Stepped lighting.** Light is cut into 2–4 fixed bands instead of a smooth gradient. Optionally snap final colours to a palette. | Smooth gradients look like 3D | `createToonMaterial({ steps, bands })`, `setPalette([...])`, `posterize` |
| 5 | **Edit the light, not just the mesh.** (a) Bend normals so lumpy shapes shade as one clean volume. (b) Cast shadows from a separate, simpler proxy shape. | Noisy facets and ugly shadows | `sphericalizeNormals(geo, k)`, `addShadowProxy(mesh, geo)` |
| 6 | **Snap to the pixel grid.** Snap the camera to whole low-res pixels, then shift the final image by the leftover sub-pixel so scrolling stays smooth. Snap moving objects, held items, joints and particle sizes too. | Pixels "swimming" or shimmering as things move | `snapCamera`, `subPixelScroll`, `snapObjects` + `obj.userData.pixelSnap = true` |
| 7 | **Rotate in steps.** Snap a character's facing to 8 (or 4, 16) directions, like flipping between sprite frames. | Smooth 3D rotation reads as "3D" | `quantizeAngle(angle, 8)` |
| 8 | **Sprite-like draw order.** Depth-test the whole character as an upright card at its pivot (2D y-sort). Then a sword that pokes into a wall is not clipped. | Weapons and limbs cut off by walls | `flattenDepth(object, { bias, keep })` → handle `.enabled` |

## How to apply

1. **Find the engine.** Check `package.json` (`three`, `@react-three/fiber`),
   `project.godot`, or `Assets/` + `ProjectSettings/`.
   - Three.js / R3F: copy `assets/threejs/pixel3d.js` into the project and wire
     it up as below.
   - Godot 4: follow `references/godot.md`.
   - Unity URP: follow `references/unity.md`.
   - Another engine: map the 8 rows above onto it, using `references/theory.md`.
2. **Camera first.** Switch to an orthographic camera and pick the pixel size.
   One low-res pixel should be about 1/100–1/200 of screen height.
3. **Add techniques 1→8 one at a time.** After each one, render a screenshot
   with it on and off, and check the difference is visible (see Verification).
4. **Tune.**
   - `outlineThreshold` is in world units. Raise it if bushes and other lumpy
     meshes get scribbled with lines.
   - `creaseThreshold` / `creaseStrength`: keep crease lines subtler than the
     outlines.
   - Toon `bands`: keep the darkest band at 0.3 or above, so shadows never go
     pure black.

### Three.js wiring

```js
import { PixelRenderer, createToonMaterial, sphericalizeNormals,
         addShadowProxy, quantizeAngle, flattenDepth } from './pixel3d.js';

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;      // crisp shadow edges
const pixel = new PixelRenderer(renderer, { pixelSize: 4 });   // (1)(2)(3)(6)
const camera = new THREE.OrthographicCamera(/* … */);

const mat = createToonMaterial({ color: 0x4f8a4a, steps: 3 });  // (4)
sphericalizeNormals(bush.geometry, 0.85);                        // (5a)
addShadowProxy(heroBody, new THREE.CylinderGeometry(.35,.35,1.2,8)); // (5b)
hero.userData.pixelSnap = true;  sword.userData.pixelSnap = true;   // (6)
const flat = flattenDepth(hero, { bias: 0.4 });                  // (8)

function frame() {
  hero.rotation.y = quantizeAngle(facing, 8);                    // (7)
  pixel.render(scene, camera);          // instead of renderer.render
}
addEventListener('resize', () => pixel.setSize(innerWidth, innerHeight));
```

Also:
- Set CSS `image-rendering: pixelated` on the canvas.
- Use `antialias: false`.
- For particles, use `THREE.Points` with `sizeAttenuation: false` and a whole
  number of pixels as the size.
- In React Three Fiber, call `pixel.render(scene, camera)` inside
  `useFrame(..., 1)` so it replaces the default render.

## Verification

Before saying the effect works, render it and look at it:
- Open the page with Playwright and take screenshots with all techniques on and
  with all off.
- Zoom crops with nearest-neighbour scaling to check 1-px outlines and steady
  pixels.
- For technique 6, take two screenshots a few frames apart while the camera
  pans. Static scenery should only shift by whole pixels.

`examples/threejs-demo/index.html` (repository root) is a working reference.
- `?off=all`, or `?off=2,8`, starts with those techniques off.
- `?t=1.3` freezes time for deterministic screenshots.
- `?pose=wall` stands the hero with the sword pushed into a cliff (technique 8
  test).

## Limits

- **Perspective cameras** work, but pixels will swim. Technique 6 assumes an
  orthographic camera.
- **Outline depth threshold:** with perspective, depth is non-linear. Use a
  much smaller `outlineThreshold` (~0.001).
- **`flattenDepth`** patches built-in three.js materials through
  `onBeforeCompile`. A custom `ShaderMaterial` needs the same vertex snippet
  pasted in by hand.
- **The normal pass** uses `MeshNormalMaterial` as a scene override. Skinned or
  morphing meshes still work. Custom vertex displacement does not show up in
  creases.
