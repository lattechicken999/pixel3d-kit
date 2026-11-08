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
the line sits on the object's own border and is 1 px thick.

**Wider outlines (2 px and up).** Do not grow the line inward only: a 2 px
inner line turns a 10 px character solid dark. Centre it on the silhouette:
```
w_in  = ceil(width/2)    // rings on the near object:  max(0, d_nb - d)
w_out = floor(width/2)   // rings on what is behind:    max(0, d - d_nb)
edge  = max over 4 neighbours at radius r of the two terms above
```
Clamp samples to the frame, or the frame border itself gets an outline.
Paint both pixels in the **near object's** colour (darkened): for the outer
pixel, sample the colour at the neighbour that is in front. Darkening the outer
pixel's own colour gives a two-tone halo tinted by the background.

## 3. Creases (normals)
The first version (kept in the Three.js module):
```
for each neighbour:
  nInd = clamp(dot(n - n_nb, normalize(1,1,1)), 0, 1)   // one-sided bias -> 1px
  dInd = clamp(sign((d_nb - d) * 0.25 + 0.0025), 0, 1)  // skip if neighbour is in front
  crease += (1 - dot(n, n_nb)) * nInd * dInd
line if crease > threshold, and only where there is no outline
```

On terrain seen from above (tested in Godot), this also lights **concave**
corners, where a wall meets the floor below it, as a broken dotted line. The
fix decides convexity from depth, not from the normal bias:
```
crease  = max over 8 neighbours of (1 - dot(n, n_nb))   // diagonals: solid on 2:1 steps
convex  = Σ over 4 neighbours at r=1 and r=2 of (d_nb - d) > epsilon
line if convex and crease > threshold, and only where there is no outline
crease colour = colour * (1 + strength)     // not mix(colour, white, s)
```
On a ledge top the pixel is nearer than its neighbours on average (positive
sum); in a concave corner it is farther (negative). Without the diagonals a
2:1 stair-stepped edge gets a dashed line, because only every other pixel has
a straight neighbour across the fold.

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

**Sub-pixel scroll is required, not optional.** With the camera snapped, the
image moves in whole low-res pixels (4 screen pixels at ×4). On a diagonal
pan the steps alternate between (1,0) and (1,1) and the whole screen
zig-zags: it reads as shaking. Render with a 1-pixel margin and shift the
upscaled image by `subPixel` every frame. Measured in the Unity demo: before,
the vertical step alternated 0/4 screen px; after, 2–3 px every frame
(std 0.35 px).

**Use the real target size for `pw`.** Read the low-res target's actual
height every frame. With OS display scaling the window can open smaller than
requested, and a hard-coded height puts the snap grid off by a fraction of a
pixel, which brings the shimmer back.

**Objects.** Snap the same way, relative to the snapped camera position. Leave
depth (the forward axis) free.

**The character the camera follows is the exception: snap it in screen
space**, relative to the *unsnapped* camera. Relative to the snapped camera
its rounding flips every time the camera crosses a pixel boundary, so it
jumps ±½ pixel every frame (measured in the Unity demo: vertical step
−1.9 / +2.1 screen px, direction reversing in 93 % of frames). The eye
follows the character, so this reads as camera shake even when the scroll
itself is perfectly smooth. Snapped in screen space it stays still (0 %
reversals). It then slides against the world grid by less than a pixel,
which is not visible on a moving character.

**Screen-locked noise.** Anything that dithers in screen space (debanding,
soft-shadow PCF noise, temporal AA) stays still while the world scrolls in
whole pixels, so it sparkles. Turn it off in pixel mode, or index it by
world-locked pixel (screen pixel + snapped camera pixel origin).

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
