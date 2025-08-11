#!/bin/sh
set -e
IN=${IN_DIR:-uploads/videos}
OUT=${OUT_DIR:-previews-anim}
H=${SCALE_HEIGHT:-360}
FPS=${FPS:-8}

mkdir -p "$OUT"
find "$IN" -type f -name "*.mp4" | while read -r f; do
  base=$(basename "$f")
  name=${base%.*}
  outw="$OUT/$name.webp"
  outg="$OUT/$name.gif"
  echo "[anim] $f -> $outw / $outg"
  # 取 1s 作为首帧预览
  ffmpeg -y -ss 1 -t 2 -i "$f" -vf "scale=-2:${H}:force_original_aspect_ratio=decrease,fps=${FPS}" -loop 0 -an -preset picture "$outw"
  ffmpeg -y -ss 1 -t 2 -i "$f" -vf "scale=-2:${H}:force_original_aspect_ratio=decrease,fps=${FPS}" -an "$outg"
done 