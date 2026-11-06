---
name: learn-from-video
description: Learn a technique from a video (YouTube link, Shorts, GDC clip, or a local .mp4), then turn it into notes or code. Extracts frames, contact sheets, the audio transcript, and the on-screen captions, so Claude can actually watch it. Use when the user shares a video and says "learn this", "apply this", "이거 학습해서 적용", "what technique is this", or wants a tutorial video turned into an implementation.
---

# Learn from a video

1. **Extract.** Run this from the plugin's skill directory:
   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/skills/learn-from-video/scripts/extract.sh" "<file-or-URL>" ./video-notes 1
   ```
   - It needs `ffmpeg`. For URLs it also needs `yt-dlp`, and an optional Whisper
     CLI gives a transcript.
   - YouTube often blocks downloads from cloud or CI servers ("confirm you're
     not a bot"). If that happens, ask the user to download the video
     themselves and attach or upload the .mp4.
   - Videos without an audio track are fine. Shorts usually put their
     explanation in on-screen captions anyway.
   - For fast-cut videos, use 2 fps.
2. **Watch.**
   - Read `info.txt`, then every `sheet_N.jpg` in order. Each sheet holds 12
     frames, read left to right and top to bottom, one frame per 1/fps seconds.
   - Open single `frames/fNNN.jpg` files when a detail matters, such as
     before/after labels or diagrams.
   - Read `transcript.txt` if it exists.
3. **Write notes.** Write `video-notes/NOTES.md` with:
   - the source: title, creator, and the talk or game it cites
   - each technique: what it is, the problem it fixes, and the before/after
     shown on screen
   - anything that was unclear, marked as a guess
4. **Apply.**
   - Map each technique onto the user's engine or codebase.
   - If a skill in this plugin already covers the topic, use it. For example,
     `pixel-3d` covers "3D that looks like pixel art / 도트".
   - Build the techniques one at a time, and screenshot each one on and off to
     prove it matches what the video shows.

Credit the original creator and any talk the video cites in the notes and the
README. Do not copy the video's art or assets. Implement the techniques.
