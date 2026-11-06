# Theory: the math behind each technique

Engine-agnostic notes. Use these to port the techniques to any renderer.

## 1. Low-res target
- **Sizes.** `inner = floor(screen / pixelSize)`. Allocate `inner + 2` (a
  1-px margin on every side). Widen the ortho frustum by one world-pixel on each
  side to fill that margin.
- **Filtering.** Use nearest filtering everywhere, on colour, depth and
  normals. Turn MSAA off: anti-aliasing invents in-between colours, which
  destroys the pixel-art look.

## 2. Outline (depth)
With an ortho camera, depth is linear: `d = depthTex * (far - near)`, in world
units.

```
edge = Σ over 4 neighbours of max(0, d_neighbour - d_center)
outline if edge > threshold
```

The test is one-sided: only the *nearer* side of a depth jump gets the line. So
the line sits on the object's own border and is never 2 px thick.

## 3. Creases (normals)
```
for each neighbour:
  nInd = clamp(dot(n - n_nb, normalize(1,1,1)), 0, 1)   // one-sided bias -> 1px
  dInd = clamp(sign((d_nb - d) * 0.25 + 0.0025), 0, 1)  // skip if neighbour is in front
  crease += (1 - dot(n, n_nb)) * nInd * dInd
line if crease > threshold, and only where there is no outline
```

To get the normals, render the scene once more with a "view-space normal"
override material (the normal pass).

## 4. Stepped light
- **Toon ramp.** Use `ramp[floor(NdotL * steps)]` instead of a smooth `NdotL`.
  Keep the darkest band at about 0.3 or above.
- **Shadows.** Use hard shadow maps: no PCF/soft filtering. Pick the shadow-map
  texel size to roughly match one screen pixel.
- **Palette (optional).** After shading, snap each colour to its nearest
  palette entry. Compare in linear RGB, or for better results in OKLab.

## 5. Authoring the light response
- **Sphericalized normals.** `n' = normalize(lerp(n, normalize(p - c), k))`.
  Lumpy foliage then shades like one ball, the way a pixel artist would paint
  it.
- **Normal transfer.** For more control, in your 3D modelling tool copy the
  normals from a simple proxy shape (sphere, capsule) onto the detailed mesh.
- **Shadow proxies.** The visible mesh has `castShadow = false`. A hidden,
  simpler mesh casts the shadow instead (a capsule for a character, a disc for
  a bush).

## 6. Pixel-grid snapping
`pw` is the world size of one low-res pixel:
`pw = (top - bottom) / zoom / inner.height`.

**Camera.** Project its position onto the camera's right and up axes, then
round to `pw`:
```
x = dot(camPos, right); y = dot(camPos, up)
sx = round(x/pw)*pw;    sy = round(y/pw)*pw
camPos += right*(sx-x) + up*(sy-y)
subPixel = ((x-sx)/pw, (y-sy)/pw)      // shift the final upscale by this
```

**Objects.** Snap the same way, relative to the snapped camera position. Leave
depth (the forward axis) free.

**Snap these too:**
- skeleton joints and held items, so limbs do not shimmer
- particle sizes, which should be whole pixels
- UI elements that sit in world space

## 7. Stepped rotation
`yaw' = round(yaw / (2π/N)) * (2π/N)`, with N = 8 by default. This applies only
to the *displayed* rotation. Gameplay keeps the exact angle.

## 8. Sprite-like ordering
Depth-test the character as an upright card at its pivot (2D y-sort):
```
fh    = horizontal camera forward
along = dot(worldPos - pivot, fh)
worldPos -= fh * (along * (1 - keep) + bias)   // only for the depth value
z_clip = project(worldPos).z                    // keep the original x,y
```
- `keep` ≈ 0.1 keeps the character's own parts in the right order relative to
  each other.
- `bias` pulls the card slightly toward the camera.

The result: a sword pushed into a wall stays visible while the character
stands in front of it, as in a 2D game.

**Alternatives:**
- Render characters in a second pass over the world, and depth-test only
  against the world depth sampled at the pivot.
- Or use stencil masks.
