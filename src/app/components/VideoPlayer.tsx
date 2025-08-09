"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

export type VideoPlayerProps = {
  src: string;
  poster?: string;
  title?: string;
  expiresAt?: number | null;
  onRequestRefreshUrl?: () => Promise<string>;
  style?: React.CSSProperties;
};

export default function VideoPlayer({ src, poster, title, expiresAt, onRequestRefreshUrl, style }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [currentSrc, setCurrentSrc] = useState(src);
  const [pipReady, setPipReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setCurrentSrc(src);
    setErrorMsg(null);
  }, [src]);

  // 初始化/切换资源
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // 清理旧实例
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setPipReady(false);

    const isHls = currentSrc.endsWith(".m3u8");

    // 为跨域资源启用 CORS
    video.crossOrigin = "anonymous";

    function onLoadedMetadata() {
      setPipReady(Boolean((document as any).pictureInPictureEnabled));
    }
    function onEmptied() { setPipReady(false); }
    function onError() {
      setErrorMsg("视频加载失败，请稍后重试");
    }

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("emptied", onEmptied);
    video.addEventListener("error", onError);

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 120,
        backBufferLength: 90,
        enableWorker: true,
        lowLatencyMode: true,
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(currentSrc);
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          if (onRequestRefreshUrl) {
            onRequestRefreshUrl()
              .then((newUrl) => setCurrentSrc(newUrl))
              .catch(() => setErrorMsg("播放出错"));
          } else {
            setErrorMsg("播放出错");
          }
        }
      });
      return () => {
        hls.destroy();
        hlsRef.current = null;
        video.removeEventListener("loadedmetadata", onLoadedMetadata);
        video.removeEventListener("emptied", onEmptied);
        video.removeEventListener("error", onError);
      };
    } else {
      // 原生播放（mp4/Safari HLS）
      video.src = currentSrc;
      video.preload = "metadata";
      return () => {
        video.removeEventListener("loadedmetadata", onLoadedMetadata);
        video.removeEventListener("emptied", onEmptied);
        video.removeEventListener("error", onError);
      };
    }
  }, [currentSrc, onRequestRefreshUrl]);

  // 过期前自动续签
  useEffect(() => {
    if (!expiresAt || !onRequestRefreshUrl) return;
    const now = Date.now();
    const msLeft = expiresAt - now;
    const refreshMs = Math.max(msLeft - 60_000, 10_000);
    const timer = setTimeout(async () => {
      try {
        const newUrl = await onRequestRefreshUrl();
        setCurrentSrc(newUrl);
      } catch {
        setErrorMsg("刷新播放地址失败");
      }
    }, refreshMs);
    return () => clearTimeout(timer);
  }, [expiresAt, onRequestRefreshUrl]);

  // 快捷键
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (video.paused) void video.play(); else video.pause();
      } else if (e.key === "ArrowRight") {
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
      } else if (e.key === "ArrowLeft") {
        video.currentTime = Math.max(0, video.currentTime - 5);
      } else if (e.key === "ArrowUp") {
        video.volume = Math.min(1, video.volume + 0.1);
      } else if (e.key === "ArrowDown") {
        video.volume = Math.max(0, video.volume - 0.1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function enterPiP() {
    const video = videoRef.current;
    if (!video) return;
    try {
      if ((document as any).pictureInPictureEnabled && video.readyState >= 1) {
        await (video as any).requestPictureInPicture();
      }
    } catch {
      // 忽略 PiP 错误
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {title && <div style={{ fontSize: 12, color: "#6b7280" }}>{title}</div>}
      <video
        ref={videoRef}
        controls
        playsInline
        poster={poster}
        crossOrigin="anonymous"
        style={{ width: "100%", borderRadius: 8, background: "#000", ...style }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6b7280" }}>
        <button onClick={enterPiP} disabled={!pipReady} style={{ background: pipReady ? "#f3f4f6" : "#e5e7eb", padding: "4px 8px", borderRadius: 6 }}>画中画</button>
        <span>双击全屏，←/→ 快进/快退</span>
      </div>
      {errorMsg && <div style={{ color: "#b91c1c", fontSize: 12 }}>{errorMsg}</div>}
    </div>
  );
} 