#!/bin/sh
# 更健壮的批量生成器：逐个文件容错处理，不因单个失败而退出
set -u
IN=${IN_DIR:-/work/uploads/videos}
OUT=${OUT_DIR:-/work/previews-vtt}
W=${SCALE_WIDTH:-240}
INTERVAL=${INTERVAL:-2}

mkdir -p "$OUT"

process_file() {
  f="$1"
  # 兼容 Windows 行尾，去掉回车符
  f=$(printf "%s" "$f" | tr -d '\r')
  [ -f "$f" ] || { echo "[skip] missing $f" >&2; return; }
  base=$(basename "$f")
  name=${base%.*}
  dir="$OUT/$name"
  mkdir -p "$dir"
  echo "[vtt] $f -> $dir/*.jpg, $OUT/$name.vtt"
  if ! ffmpeg -y -hide_banner -loglevel error -i "$f" -vf "fps=1/${INTERVAL},scale=${W}:-2" "$dir/%03d.jpg"; then
    echo "[warn] ffmpeg failed for $f, skip" >&2
    return
  fi
  vtt="$OUT/$name.vtt"
  echo "WEBVTT" > "$vtt"
  duration=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$f" 2>/dev/null || echo 0)
  duration=${duration%.*}
  [ -z "$duration" ] && duration=0
  start=0
  idx=1
  while [ $start -lt $duration ]; do
    end=$((start+INTERVAL)); [ $end -gt $duration ] && end=$duration
    s=$(printf '%02d:%02d:%02d.000' $((start/3600)) $((start%3600/60)) $((start%60)))
    e=$(printf '%02d:%02d:%02d.000' $((end/3600)) $((end%3600/60)) $((end%60)))
    img=$(printf '%03d.jpg' $idx)
    echo "${s} --> ${e}" >> "$vtt"
    echo "$name/$img" >> "$vtt"
    echo "" >> "$vtt"
    start=$end; idx=$((idx+1))
  done
}

# 兼容 0-2 级子目录（例如日期分层）
for f in "$IN"/*.mp4 "$IN"/*/*.mp4 "$IN"/*/*/*.mp4; do
  [ -e "$f" ] || continue
  process_file "$f"
done