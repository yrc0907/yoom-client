"use client";
import { useEffect, useRef } from "react";
import Hls from "hls.js";

export type LiveHlsPlayerProps = {
  src: string;
  allowSeek?: boolean; // 默认不允许，强制保持在直播边缘
  style?: React.CSSProperties;
  poster?: string;
  autoPlay?: boolean;
};

export default function LiveHlsPlayer({ src, allowSeek = false, style, poster, autoPlay = true }: LiveHlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // 清理旧实例
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = src.endsWith(".m3u8");
    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 10,
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        liveSyncDuration: 2,
        liveMaxLatencyDuration: 6,
        maxLiveSyncPlaybackRate: 1.2,
        // 从直播边缘开始
        startPosition: -1,
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(src);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        try { hls.startLoad(-1); } catch { /* noop */ }
        if (autoPlay) video.play().catch(() => { });
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          try { hls.destroy(); } catch { }
        }
      });
    } else {
      // 浏览器原生 HLS（如 Safari）
      video.src = src;
      if (autoPlay) video.play().catch(() => { });
    }

    function onSeeking() {
      if (allowSeek) return;
      // 强制保持在直播边缘
      const v = videoRef.current;
      if (!v) return;
      try {
        const seekable = v.seekable;
        if (seekable && seekable.length > 0) {
          const liveEdge = seekable.end(seekable.length - 1) - 0.5; // 留 0.5s 缓冲
          if (Math.abs(v.currentTime - liveEdge) > 1.0) {
            v.currentTime = liveEdge;
          }
        }
      } catch { }
    }

    function onLoadedMetadata() {
      // 进入直播边缘
      const v = videoRef.current;
      if (!v) return;
      try {
        const seekable = v.seekable;
        if (seekable && seekable.length > 0) {
          const liveEdge = seekable.end(seekable.length - 1) - 0.5;
          v.currentTime = liveEdge;
        }
      } catch { }
    }

    video.addEventListener("seeking", onSeeking);
    video.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch { }
        hlsRef.current = null;
      }
    };
  }, [src, allowSeek, autoPlay]);

  return (
    <video
      ref={videoRef}
      controls
      playsInline
      poster={poster}
      style={{ width: "100%", borderRadius: 8, background: "#000", ...style }}
      // 为了避免浏览器自动缓存太多，live 推荐 metadata
      preload="metadata"
      muted
    />
  );
}


