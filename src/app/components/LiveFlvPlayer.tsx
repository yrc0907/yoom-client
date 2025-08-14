"use client";
import { useEffect, useRef } from "react";
import flvjs from "flv.js";

export default function LiveFlvPlayer({ src, autoPlay = true }: { src: string; autoPlay?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<flvjs.Player | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (playerRef.current) { try { playerRef.current.destroy(); } catch { } playerRef.current = null; }

    if (flvjs.isSupported()) {
      const player = flvjs.createPlayer({ type: 'flv', url: src, isLive: true, hasAudio: true, hasVideo: true }, {
        enableStashBuffer: false,
        fixAudioTimestampGap: true,
        autoCleanupSourceBuffer: true,
        reuseRedirectedURL: true,
        liveBufferLatencyChasing: true,
        lazyLoad: false,
      });
      player.attachMediaElement(video);
      player.load();
      if (autoPlay) setTimeout(() => video.play().catch(() => { }), 0);
      playerRef.current = player;
    } else {
      // 一些浏览器不支持 MediaSource + FLV，这里直接回退为原生播放
      video.src = src;
      if (autoPlay) video.play().catch(() => { });
    }

    return () => { if (playerRef.current) { try { playerRef.current.destroy(); } catch { } playerRef.current = null; } };
  }, [src, autoPlay]);

  return <video ref={videoRef} controls playsInline muted style={{ width: '100%', background: '#000', borderRadius: 8 }} />;
}


