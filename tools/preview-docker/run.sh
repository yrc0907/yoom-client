#!/bin/sh
set -e
IN=${IN_DIR:-uploads/videos}
OUT=${OUT_DIR:-previews}
H=${SCALE_HEIGHT:-480}
VBR=${VIDEO_BR:-600k}
VMAX=${VIDEO_MAX:-800k}
VBUF=${VIDEO_BUF:-1200k}
ABR=${AUDIO_BR:-96k}

mkdir -p "$OUT"
find "$IN" -type f -name "*.mp4" | while read -r f; do
  base=$(basename "$f")
  name=${base%.*}
  outp="$OUT/$name.mp4"
  echo "[preview] $f -> $outp"
  ffmpeg -y -i "$f" \
    -vf "scale=-2:${H}:force_original_aspect_ratio=decrease" \
    -c:v libx264 -profile:v baseline -preset veryfast -b:v ${VBR} -maxrate ${VMAX} -bufsize ${VBUF} \
    -g 48 -keyint_min 48 -sc_threshold 0 -movflags +faststart \
    -c:a aac -b:a ${ABR} -ac 2 "$outp"
done 