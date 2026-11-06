---
description: Apply the 3D→pixel-art look (outline, stepped light, pixel snapping, sprite-like sorting) to this project
argument-hint: "[engine or path] [pixel size] [techniques e.g. 1-6,8]"
---

Use the `pixel-3d` skill to make this project's 3D rendering look like hand-made
pixel art.

Arguments: $ARGUMENTS

Steps:
1. **Find the engine and main render loop.** Detect Three.js / R3F, Godot 4 or
   Unity URP. If the arguments name an engine or path, use that. If no 3D scene
   exists, say so and offer `/pixel3d-new` instead.
2. **Choose the techniques.** Apply all 8 unless the arguments limit them. The
   pixel size defaults to 4.
3. **Wire it in.**
   - For Three.js, copy `${CLAUDE_PLUGIN_ROOT}/skills/pixel-3d/assets/threejs/pixel3d.js`
     into the project's source folder, then hook it into the existing renderer,
     camera, materials, characters and particles.
   - Keep the project's own structure. Do not rewrite unrelated code.
   - Switch to an orthographic camera only after telling the user, because it
     changes the game's framing.
4. **Add a debug toggle for each technique**: a key, or URL flags, or a dev GUI
   if the project has one.
5. **Verify.** Run the app and capture screenshots with everything on and with
   everything off, plus a zoomed crop. Report what changed, which values you
   tuned, and anything that could not be applied.
