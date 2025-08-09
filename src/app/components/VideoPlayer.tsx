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
  storageId?: string;
};

export default function VideoPlayer({ src, poster, title, expiresAt, onRequestRefreshUrl, style, storageId }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [currentSrc, setCurrentSrc] = useState(src);
  const [pipReady, setPipReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [levels, setLevels] = useState<{ index: number; label: string }[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<number>(-1);

  const timeKey = storageId ? `vp:last:${storageId}` : undefined;

  useEffect(() => {
    setCurrentSrc(src);
    setErrorMsg(null);
  }, [src]);

  // 初始化/切换资源
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setPipReady(false);
    setLevels([]);
    setSelectedLevel(-1);

    const isHls = currentSrc.endsWith(".m3u8");

    video.crossOrigin = "anonymous";

    function onLoadedMetadata() {
      setPipReady(Boolean((document as any).pictureInPictureEnabled));
      if (timeKey) {
        const saved = Number(localStorage.getItem(timeKey) || 0);
        if (Number.isFinite(saved) && saved > 1 && video.duration && saved < video.duration - 1) {
          video.currentTime = saved;
        }
      }
    }
    function onTimeUpdate() {
      if (timeKey) localStorage.setItem(timeKey, String(Math.floor(video.currentTime)));
    }
    function onEmptied() { setPipReady(false); }
    function onError() { setErrorMsg("视频加载失败，请稍后重试"); }

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("emptied", onEmptied);
    video.addEventListener("error", onError);

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, enableWorker: true });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(currentSrc);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const lvls = hls.levels.map((l, i) => ({ index: i, label: `${Math.round(l.bitrate / 1000)} kbps` }));
        setLevels([{ index: -1, label: "自动" }, ...lvls]);
        setSelectedLevel(hls.currentLevel);
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => setSelectedLevel(data.level));
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          if (onRequestRefreshUrl) {
            onRequestRefreshUrl().then((u) => setCurrentSrc(u)).catch(() => setErrorMsg("播放出错"));
          } else {
            setErrorMsg("播放出错");
          }
        }
      });
      return () => {
        hls.destroy();
        hlsRef.current = null;
        video.removeEventListener("loadedmetadata", onLoadedMetadata);
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("emptied", onEmptied);
        video.removeEventListener("error", onError);
      };
    } else {
      video.src = currentSrc;
      video.preload = "metadata";
      return () => {
        video.removeEventListener("loadedmetadata", onLoadedMetadata);
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("emptied", onEmptied);
        video.removeEventListener("error", onError);
      };
    }
  }, [currentSrc, onRequestRefreshUrl, timeKey]);

  useEffect(() => {
    const v = videoRef.current; if (!v) return; v.playbackRate = playbackRate;
  }, [playbackRate]);

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
    } catch { }
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
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "#6b7280" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <label>倍速</label>
          <select value={playbackRate} onChange={(e) => setPlaybackRate(Number(e.target.value))} style={{ padding: "2px 6px", borderRadius: 6 }}>
            {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(r => <option key={r} value={r}>{r}x</option>)}
          </select>
          {levels.length > 0 && (
            <>
              <label>清晰度</label>
              <select value={selectedLevel} onChange={(e) => { const l = Number(e.target.value); setSelectedLevel(l); if (hlsRef.current) hlsRef.current.currentLevel = l; }} style={{ padding: "2px 6px", borderRadius: 6 }}>
                {levels.map(l => <option key={l.index} value={l.index}>{l.label}</option>)}
              </select>
            </>
          )}
        </div>
        <button onClick={enterPiP} disabled={!pipReady} style={{ background: pipReady ? "#f3f4f6" : "#e5e7eb", padding: "4px 8px", borderRadius: 6 }}>画中画</button>
      </div>
      {errorMsg && <div style={{ color: "#b91c1c", fontSize: 12 }}>{errorMsg}</div>}
    </div>
  );
} 