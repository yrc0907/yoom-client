"use client";
/* eslint-disable */
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import "plyr/dist/plyr.css";

export type VideoPlayerProps = {
  src: string;
  poster?: string;
  title?: string;
  expiresAt?: number | null;
  onRequestRefreshUrl?: () => Promise<string>;
  style?: React.CSSProperties;
  storageId?: string;
};

export default function VideoPlayer({ src, poster, title, expiresAt, onRequestRefreshUrl, style, storageId }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const plyrRef = useRef<any | null>(null);
  const [currentSrc, setCurrentSrc] = useState(src);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const timeKey = storageId ? `vp:last:${storageId}` : undefined;

  useEffect(() => {
    setCurrentSrc(src);
    setErrorMsg(null);
  }, [src]);

  // 初始化/切换资源 + Plyr 控件（仅在浏览器端执行）
  useEffect(() => {
    if (typeof window === "undefined") return; // SSR 保护
    const video = videoRef.current;
    if (!video) return;

    // 清理旧实例
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (plyrRef.current) { plyrRef.current.destroy(); plyrRef.current = null; }

    const isHls = currentSrc.endsWith(".m3u8");
    video.crossOrigin = "anonymous";

    function onLoadedMetadata() {
      if (timeKey) {
        const saved = Number(localStorage.getItem(timeKey) || 0);
        if (Number.isFinite(saved) && saved > 1 && video.duration && saved < video.duration - 1) {
          video.currentTime = saved;
        }
      }
    }
    function onTimeUpdate() { if (timeKey) localStorage.setItem(timeKey, String(Math.floor(video.currentTime))); }
    function onError() { setErrorMsg("视频加载失败，请稍后重试"); }

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("error", onError);

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, enableWorker: true });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(currentSrc));
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          if (onRequestRefreshUrl) onRequestRefreshUrl().then((u) => setCurrentSrc(u)).catch(() => setErrorMsg("播放出错"));
          else setErrorMsg("播放出错");
        }
      });
    } else {
      video.src = currentSrc;
      video.preload = "metadata";
    }

    let destroyed = false;
    (async () => {
      try {
        const PlyrMod = await import("plyr");
        if (destroyed) return;
        const plyr = new PlyrMod.default(video, {
          controls: [
            "play-large",
            "play",
            "progress",
            "current-time",
            "mute",
            "volume",
            "settings",
            "pip",
            "airplay",
            "fullscreen",
          ],
          settings: ["speed"],
          speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] },
          i18n: { play: "播放", pause: "暂停", mute: "静音", unmute: "取消静音", fullscreen: "全屏", settings: "设置", speed: "倍速", pip: "画中画" },
        });
        plyrRef.current = plyr;
      } catch { }
    })();

    return () => {
      destroyed = true;
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (plyrRef.current) { plyrRef.current.destroy(); plyrRef.current = null; }
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("error", onError);
    };
  }, [currentSrc, onRequestRefreshUrl, timeKey]);

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

  return (
    <div className="plyr__video-embed" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {title && <div style={{ fontSize: 12, color: "#6b7280" }}>{title}</div>}
      <video
        ref={videoRef}
        controls
        playsInline
        poster={poster}
        crossOrigin="anonymous"
        style={{ width: "100%", borderRadius: 8, background: "#000", ...style }}
      />
      {errorMsg && <div style={{ color: "#b91c1c", fontSize: 12 }}>{errorMsg}</div>}
    </div>
  );
}