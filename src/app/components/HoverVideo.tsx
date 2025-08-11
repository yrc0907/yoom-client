"use client";

import { useEffect, useRef, useState } from "react";

export type HoverVideoProps = {
  src: string; // 主资源（备用）
  previewSrc?: string; // 480p 预览
  preview360Src?: string; // 360p 预览
  animSrc?: string; // 动图（webp/gif）
  thumbsBase?: string; // VTT 与图片基路径：previews-vtt/{base}
  poster?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
  previewStrategy?: "auto" | "360" | "480";
  vttMode?: "auto" | "sprite" | "frame";
};

export default function HoverVideo({ src, previewSrc, preview360Src, animSrc, thumbsBase, poster, onClick, style, previewStrategy = "auto", vttMode = "auto" }: HoverVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [activeSrc, setActiveSrc] = useState<string | null>(null); // 悬停/可见后才赋值
  const [hasPrefetched, setHasPrefetched] = useState(false);
  const [mp4Ready, setMp4Ready] = useState(false);
  const [handoverAllowedAt, setHandoverAllowedAt] = useState<number>(0);
  const [showAnim, setShowAnim] = useState<boolean>(!!animSrc);
  const [hoverMs, setHoverMs] = useState<number>(300);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbLeftPx, setThumbLeftPx] = useState<number | null>(null);
  const [hoverSec, setHoverSec] = useState<number>(0);

  // 选择 360/480
  function selectPreview(): string | undefined {
    const fallback = previewSrc || preview360Src;
    if (previewStrategy === "360") return preview360Src || fallback;
    if (previewStrategy === "480") return previewSrc || fallback;
    // auto：根据网络与 dpr
    const et = (navigator as any)?.connection?.effectiveType as string | undefined;
    const dpr = window.devicePixelRatio || 1;
    const isGoodNet = et ? ["4g", "wifi"].includes(et) : true;
    if (!isGoodNet || dpr < 1.5) {
      return preview360Src || fallback;
    }
    return previewSrc || fallback;
  }

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    function onTime() { if (!el?.duration) return; setProgress((el.currentTime / el.duration) * 100); }
    function onLoaded() { setMp4Ready(true); if (Date.now() >= handoverAllowedAt) { setShowAnim(false); } }
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("canplay", onLoaded);
    el.addEventListener("loadeddata", onLoaded);
    return () => { el.removeEventListener("timeupdate", onTime); el.removeEventListener("canplay", onLoaded); el.removeEventListener("loadeddata", onLoaded); };
  }, [handoverAllowedAt]);

  function playWhenReady(el: HTMLVideoElement) {
    const tryPlay = () => { el.muted = true; el.loop = true; el.play().catch(() => { }); el.removeEventListener("loadeddata", tryPlay); el.removeEventListener("canplay", tryPlay); };
    if (el.readyState >= 2) { tryPlay(); } else { el.addEventListener("loadeddata", tryPlay); el.addEventListener("canplay", tryPlay); }
  }

  function ensureLoadedAndPlay() {
    const el = videoRef.current; if (!el) return;
    if (!activeSrc) setActiveSrc(selectPreview() || null);
    queueMicrotask(() => { const v = videoRef.current; if (!v) return; playWhenReady(v); });
  }

  function play() { const el = videoRef.current; if (!el) return; el.muted = true; el.loop = true; el.play().catch(() => { }); }
  function pause(reset = false) { const el = videoRef.current; if (!el) return; el.pause(); if (reset) el.currentTime = 0; }

  function onEnter() { setHovered(true); setHandoverAllowedAt(Date.now() + hoverMs); ensureLoadedAndPlay(); }
  function onLeave() { setHovered(false); pause(true); setThumbUrl(null); setShowAnim(!!animSrc); }

  function seekByClientX(clientX: number, track: HTMLDivElement) {
    const el = videoRef.current; if (!el || !el.duration) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration; setProgress(ratio * 100); el.play().catch(() => { });
  }

  // 拖动时显示 VTT 缩略图（优先雪碧图）
  function updateThumbByClientX(clientX: number, track: HTMLDivElement) {
    if (!thumbsBase) return;
    const el = videoRef.current; if (!el || !el.duration) return;
    const rect = track.getBoundingClientRect();
    const relX = clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, relX / rect.width));
    const t = Math.floor(ratio * el.duration);
    const idx = Math.max(1, Math.floor(t / 2) + 1);
    setHoverSec(t);
    // 让预览图始终完全显示：预留半个预览宽度 + 边距
    const PREVIEW_W = 200; // 固定宽度，避免随拖动缩放
    const half = PREVIEW_W / 2;
    const margin = 8;
    const clamped = Math.max(half + margin, Math.min(rect.width - half - margin, relX));
    setThumbLeftPx(clamped);
    // 模式选择：auto 默认走逐帧；仅当显式指定 sprite 时使用雪碧图
    const useSprite = vttMode === "sprite";
    if (useSprite) {
      const img = `/api/s3/proxy?key=${encodeURIComponent(`${thumbsBase}/sprite.jpg`)}`;
      const fw = 240;
      const col = ((idx - 1) % 10);
      const row = Math.floor((idx - 1) / 10);
      const y = row * fw;
      const x = col * fw;
      setThumbUrl(`${img}#xywh=${x},${y},${fw},${fw}`);
      return;
    }
    // 逐帧
    const img = `/api/s3/proxy?key=${encodeURIComponent(`${thumbsBase}/${String(idx).padStart(3, '0')}.jpg`)}`;
    setThumbUrl(img);
  }

  // 可见即小量预加载（metadata）
  useEffect(() => {
    const rootEl = containerRef.current; if (!rootEl) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio > 0.25) {
          const el = videoRef.current; if (!el) break;
          if (!hasPrefetched) {
            if (!activeSrc) setActiveSrc(selectPreview() || null);
            queueMicrotask(() => { const v = videoRef.current; if (!v) return; v.preload = "metadata"; try { v.load(); } catch { }; setHasPrefetched(true); });
          }
          break;
        }
      }
    }, { root: null, rootMargin: "200px", threshold: [0, 0.25, 0.5, 1] });
    io.observe(rootEl);
    return () => io.disconnect();
  }, [activeSrc, hasPrefetched, previewSrc, src, previewStrategy, preview360Src]);

  useEffect(() => { if (mp4Ready && Date.now() >= handoverAllowedAt) setShowAnim(false); }, [mp4Ready, handoverAllowedAt]);

  return (
    <div ref={containerRef} onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={onClick} style={{ position: "relative", cursor: "pointer", background: "#000", ...style }}>
      {animSrc && (
        <img src={animSrc} alt="预览" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: showAnim ? 1 : 0, transition: "opacity .16s ease" }} draggable={false} />
      )}
      <video ref={videoRef} src={activeSrc || undefined} poster={poster} muted playsInline preload="none" style={{ width: "100%", display: "block", opacity: showAnim ? 0 : 1, transition: "opacity .16s ease" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 120, background: "linear-gradient(180deg, transparent, rgba(0,0,0,.35))", opacity: hovered || dragging ? 1 : 0, transition: "opacity .2s ease", display: "flex", alignItems: "flex-end", overflow: "visible" }}>
        <div
          style={{ position: "relative", width: "100%", height: 6, margin: "0 8px 6px", background: "rgba(255,255,255,.25)", borderRadius: 4 }}
          onMouseDown={(e) => { e.stopPropagation(); setDragging(true); ensureLoadedAndPlay(); seekByClientX(e.clientX, e.currentTarget); updateThumbByClientX(e.clientX, e.currentTarget); }}
          onMouseMove={(e) => { e.stopPropagation(); if (dragging) { seekByClientX(e.clientX, e.currentTarget); } updateThumbByClientX(e.clientX, e.currentTarget); }}
          onMouseUp={(e) => { e.stopPropagation(); setDragging(false); play(); setThumbUrl(null); }}
          onMouseLeave={(e) => { e.stopPropagation(); setDragging(false); setThumbUrl(null); }}
          onClick={(e) => { e.stopPropagation(); }}
        >
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${progress}%`, background: "var(--plyr-color-main, #2563eb)", borderRadius: 4 }} />
          {thumbUrl && (
            <div style={{ position: "absolute", bottom: 26, left: thumbLeftPx != null ? `${thumbLeftPx}px` : `${progress}%`, transform: "translateX(-50%)", pointerEvents: "none", width: 200 }}>
              <div style={{ width: 200, height: 112, background: "#000", borderRadius: 8, overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,.45)" }}>
                <img src={thumbUrl} alt="thumb" style={{ width: 200, height: 112, objectFit: "cover", display: "block" }} />
              </div>
              <div style={{ marginTop: 6, textAlign: "center", fontSize: 12, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,.6)", fontVariantNumeric: "tabular-nums" }}>
                {new Date(hoverSec * 1000).toISOString().slice(11, 19)} / {(() => { const el = videoRef.current; const d = el?.duration || 0; return new Date(Math.floor(d) * 1000).toISOString().slice(11, 19); })()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 