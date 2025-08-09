"use client";

import { useEffect, useRef, useState } from "react";

export type HoverVideoProps = {
  src: string;
  poster?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
};

export default function HoverVideo({ src, poster, onClick, style }: HoverVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    function onTime() {
      if (!el.duration) return;
      setProgress((el.currentTime / el.duration) * 100);
    }
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, []);

  function play() {
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
    el.loop = true;
    el.play().catch(() => { });
  }
  function pause(reset = false) {
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    if (reset) el.currentTime = 0;
  }

  function onEnter() { setHovered(true); play(); }
  function onLeave() { setHovered(false); pause(true); }

  function seekByClientX(clientX: number, track: HTMLDivElement) {
    const el = videoRef.current; if (!el || !el.duration) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
    setProgress(ratio * 100);
    // 确保在点击/拖拽时保持播放
    el.play().catch(() => { });
  }

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onClick}
      style={{ position: "relative", cursor: "pointer", background: "#000", ...style }}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        muted
        playsInline
        preload="metadata"
        style={{ width: "100%", display: "block" }}
      />

      {/* 进度条 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 18,
          background: "linear-gradient(180deg, transparent, rgba(0,0,0,.35))",
          opacity: hovered || dragging ? 1 : 0,
          transition: "opacity .2s ease",
          display: "flex",
          alignItems: "flex-end",
        }}
      >
        <div
          style={{ position: "relative", width: "100%", height: 6, margin: "0 8px 6px", background: "rgba(255,255,255,.25)", borderRadius: 4 }}
          onMouseDown={(e) => { e.stopPropagation(); setDragging(true); seekByClientX(e.clientX, e.currentTarget); }}
          onMouseMove={(e) => { e.stopPropagation(); if (dragging) seekByClientX(e.clientX, e.currentTarget); }}
          onMouseUp={(e) => { e.stopPropagation(); setDragging(false); play(); }}
          onMouseLeave={(e) => { e.stopPropagation(); setDragging(false); }}
          onClick={(e) => { e.stopPropagation(); }}
        >
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${progress}%`, background: "var(--plyr-color-main, #2563eb)", borderRadius: 4 }} />
        </div>
      </div>
    </div>
  );
} 