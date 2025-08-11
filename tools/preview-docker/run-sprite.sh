#!/bin/sh
set -e
IN=${IN_DIR:-uploads/videos}
OUT=${OUT_DIR:-previews-vtt}
W=${SCALE_WIDTH:-240}
INTERVAL=${INTERVAL:-2}
COLS=${COLS:-10}
ROWS=${ROWS:-10}
TOTAL=$((COLS*ROWS))

mkdir -p "$OUT"
find "$IN" -type f -name "*.mp4" | while read -r f; do
  base=$(basename "$f")
  name=${base%.*}
  dir="$OUT/$name"
  mkdir -p "$dir"
  echo "[sprite] $f -> $dir/sprite.jpg, $OUT/$name-sprite.vtt"
  # 先抽帧到临时目录
  tmp="$dir/tmp"
  rm -rf "$tmp" && mkdir -p "$tmp"
  ffmpeg -y -i "$f" -vf "fps=1/${INTERVAL},scale=${W}:-2" "$tmp/%03d.jpg"
  # 仅取前 TOTAL 帧
  ls "$tmp"/*.jpg | sort | head -n $TOTAL | nl -n ln -w 3 -s '' | while read -r idx file; do cp "$file" "$dir/$idx.jpg"; done
  # 拼接雪碧图（纵向再横向）
  # 先将每行水平拼接
  i=1
  row=1
  rows_files=""
  while [ $row -le $ROWS ]; do
    files=""
    c=1
    while [ $c -le $COLS ]; do
      img=$(printf '%s/%03d.jpg' "$dir" $i)
      if [ -f "$img" ]; then files="$files|$img"; fi
      i=$((i+1)); c=$((c+1))
    done
    files=${files#|}
    if [ -n "$files" ]; then
      ffmpeg -y -i "concat:$files" -filter_complex hstack=inputs=$COLS "$dir/row_$row.jpg"
      rows_files="$rows_files|$dir/row_$row.jpg"
    fi
    row=$((row+1))
  done
  rows_files=${rows_files#|}
  ffmpeg -y -i "concat:$rows_files" -filter_complex vstack=inputs=$ROWS "$dir/sprite.jpg"

  # 生成 VTT with #xywh
  sprite="$dir/sprite.jpg"
  vtt="$OUT/$name-sprite.vtt"
  echo "WEBVTT" > "$vtt"

  # 计算单帧高度（从第一帧获取尺寸）
  first=$(printf '%s/%03d.jpg' "$dir" 1)
  wh=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$first")
  fw=${wh%x*}
  fh=${wh#*x}
  x=0; y=0; col=1; row=1; idx=1; start=0
  while [ $idx -le $TOTAL ]; do
    end=$((start+INTERVAL))
    s=$(printf '%02d:%02d:%02d.000' $(($start/3600)) $(($start%3600/60)) $(($start%60)))
    e=$(printf '%02d:%02d:%02d.000' $(($end/3600)) $(($end%3600/60)) $(($end%60)))
    echo "${s} --> ${e}" >> "$vtt"
    echo "$name/sprite.jpg#xywh=$x,$y,$fw,$fh" >> "$vtt"
    echo "" >> "$vtt"
    # 下一格
    col=$((col+1))
    if [ $col -gt $COLS ]; then col=1; row=$((row+1)); x=0; y=$((y+fh)); else x=$((x+fw)); fi
    start=$end; idx=$((idx+1))
  done
  rm -rf "$tmp" "$dir"/row_*.jpg "$dir"/*.jpg 2>/dev/null || true

done 