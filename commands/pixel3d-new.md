---
description: Scaffold a new browser game/scene that renders 3D as pixel art (Three.js + pixel3d)
argument-hint: "[folder name] [scene idea]"
---

Create a new Three.js project that uses the `pixel-3d` skill.

Arguments: $ARGUMENTS. The first word is the folder name, defaulting to
`pixel3d-game`. The rest describes the scene.

1. Start from `${CLAUDE_PLUGIN_ROOT}/examples/threejs-demo/index.html`.
   - Copy it and `${CLAUDE_PLUGIN_ROOT}/skills/pixel-3d/assets/threejs/pixel3d.js`
     into the new folder.
   - Fix the import path so it points at the copied module.
2. Replace the demo scene with the scene the user described, keeping:
   - the orthographic camera
   - the toon materials
   - snapping flags on moving things
   - stepped rotation and `flattenDepth` on characters
   - the per-technique toggle panel
3. Use only original shapes and colours. Do not recreate a specific existing
   game's characters, levels or art.
4. Serve it (`python3 -m http.server`), take a screenshot, and check it. Then
   tell the user how to run it.
