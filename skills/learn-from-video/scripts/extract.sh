#!/usr/bin/env bash
# extract.sh <video-file-or-URL> [out-dir] [fps]
# Turns a (short) video into things Claude can read:
#   frames/      one JPEG per 1/fps seconds
#   sheet_N.jpg  6x2 contact sheets (12 frames each) for quick viewing
#   audio.wav    16 kHz mono, if the video has an audio track
#   transcript.txt  if a Whisper CLI is installed (whisper / whisper-cli / faster-whisper)
#   info.txt     duration, size, what was / was not produced
set -euo pipefail

SRC="${1:?usage: extract.sh <video-file-or-URL> [out-dir] [fps]}"
OUT="${2:-./video-notes}"
FPS="${3:-1}"
mkdir -p "$OUT/frames"
command -v ffmpeg >/dev/null || { echo "ffmpeg is required (apt install ffmpeg / brew install ffmpeg)"; exit 1; }

if [[ "$SRC" =~ ^https?:// ]]; then
  command -v yt-dlp >/dev/null || { echo "yt-dlp is required for URLs (pip install yt-dlp)"; exit 1; }
  yt-dlp -q -f "bv*[height<=1080]+ba/b" --merge-output-format mp4 \
    --write-description --write-info-json --write-auto-subs --sub-langs "ko.*,en.*" \
    -o "$OUT/source.%(ext)s" "$SRC" || { echo "download failed (YouTube may block servers: run this on your own machine or pass a local file)"; exit 1; }
  SRC="$(ls "$OUT"/source.mp4 "$OUT"/source.* 2>/dev/null | grep -Ev '\.(json|description|vtt)$' | head -1)"
fi

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC")
SIZE=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$SRC")
{ echo "source: $SRC"; echo "duration_s: $DUR"; echo "video: $SIZE"; echo "fps_sampled: $FPS"; } > "$OUT/info.txt"

ffmpeg -v error -y -i "$SRC" -vf "fps=$FPS,scale=360:-2" "$OUT/frames/f%03d.jpg"
N=$(ls "$OUT/frames" | wc -l)
i=0
for ((s=1; s<=N; s+=12)); do
  ffmpeg -v error -y -start_number "$s" -i "$OUT/frames/f%03d.jpg" -frames:v 1 -vf "tile=6x2" "$OUT/sheet_$i.jpg"
  i=$((i+1))
done
echo "frames: $N, contact sheets: $i (each = 12 frames, left->right, top->bottom)" >> "$OUT/info.txt"

if ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$SRC" | grep -q .; then
  ffmpeg -v error -y -i "$SRC" -ac 1 -ar 16000 "$OUT/audio.wav"
  if command -v whisper >/dev/null; then
    whisper "$OUT/audio.wav" --model small --output_format txt --output_dir "$OUT" >/dev/null 2>&1 \
      && mv "$OUT/audio.txt" "$OUT/transcript.txt" && echo "transcript: whisper" >> "$OUT/info.txt"
  elif command -v whisper-cli >/dev/null && [ -n "${WHISPER_MODEL:-}" ]; then
    whisper-cli -m "$WHISPER_MODEL" -f "$OUT/audio.wav" -otxt -of "$OUT/transcript" >/dev/null 2>&1 \
      && echo "transcript: whisper.cpp" >> "$OUT/info.txt"
  elif python3 -c "import faster_whisper" 2>/dev/null; then
    python3 - "$OUT" <<'PY' && echo "transcript: faster-whisper" >> "$OUT/info.txt"
import sys
from faster_whisper import WhisperModel
out = sys.argv[1]
segs, _ = WhisperModel("small", compute_type="int8").transcribe(f"{out}/audio.wav")
open(f"{out}/transcript.txt", "w").write("\n".join(f"[{s.start:6.1f}s] {s.text.strip()}" for s in segs))
PY
  else
    echo "transcript: none (install one: pip install openai-whisper | pip install faster-whisper)" >> "$OUT/info.txt"
  fi
else
  echo "audio: none in file (YouTube 'videoplayback' downloads are often video-only; on-screen captions in the frames are the main source)" >> "$OUT/info.txt"
fi
cat "$OUT/info.txt"
