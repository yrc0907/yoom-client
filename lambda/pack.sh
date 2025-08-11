#!/bin/sh
set -e
apt-get update >/dev/null && apt-get install -y xz-utils zip coreutils >/dev/null
rm -rf /tmp/src && mkdir -p /tmp/src/bin
cp /work/lambda/index.mjs /tmp/src/
cp /work/lambda/package.json /tmp/src/
cp -r /work/lambda/node_modules /tmp/src/
tar -xJf /work/fflayer/ff.tar.xz -C /tmp
# 动态定位 ffmpeg 可执行文件（无论官方包目录名是什么）
FF=$(find /tmp -type f -name ffmpeg 2>/dev/null | head -n1)
[ -n "$FF" ] || { echo "ffmpeg not found in archive"; exit 1; }
cp "$FF" /tmp/src/bin/ffmpeg && chmod +x /tmp/src/bin/ffmpeg
cd /tmp/src && zip -r /work/lambda/function.zip . >/dev/null
ls -l /work/lambda/function.zip