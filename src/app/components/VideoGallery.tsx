"use client";

import { useEffect, useMemo, useState } from "react";
import VideoPlayer from "@/app/components/VideoPlayer";
import HoverVideo from "@/app/components/HoverVideo";

// 类型定义

type VideoItem = {
  key: string;
  url: string;
  hlsUrl?: string | null;
  posterUrl?: string | null;
  previewUrl?: string | null;
  preview360Url?: string | null;
  animUrl?: string | null;
  thumbsBase?: string | null;
  size?: number;
  lastModified?: string;
};

type ListResponse = {
  items: VideoItem[];
  nextToken: string | null;
  expires: number;
};

export default function VideoGallery() {
  const [items, setItems] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [expires, setExpires] = useState<number>(600);
  const [openedKey, setOpenedKey] = useState<string | null>(null);

  // 预览策略：auto/360/480；帧预览：auto/sprite/frame
  const [previewStrategy, setPreviewStrategy] = useState<"auto" | "360" | "480">("auto");
  const [vttMode, setVttMode] = useState<"auto" | "sprite" | "frame">("auto");

  const limit = useMemo(() => 12, []);

  async function load(token?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/s3/videos", window.location.origin);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("expires", "600");
      url.searchParams.set("includeHls", "1");
      if (token) url.searchParams.set("token", token);

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as ListResponse;
      setItems((prev) => (token ? [...prev, ...data.items] : data.items));
      setNextToken(data.nextToken);
      setExpires(data.expires ?? 600);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "加载失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(null); }, []);

  // 手动轻量预取：对首屏前三个用 Range 拉取前 64KB
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const first = items.slice(0, 3);
        await Promise.all(first.map(async (it) => {
          const fallback = `/api/s3/proxy?key=${encodeURIComponent(it.key)}&expires=600`;
          const href = it.preview360Url || it.previewUrl || fallback;
          await fetch(href, { headers: { Range: "bytes=0-65535" }, signal: controller.signal });
        }));
      } catch { }
    })();
    return () => controller.abort();
  }, [items]);

  const prefetchCount = 6;

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>已上传视频</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label htmlFor="sel-quality" style={{ fontSize: 12, color: "#6b7280" }}>预览清晰度</label>
          <select id="sel-quality" value={previewStrategy} onChange={(e) => setPreviewStrategy(e.target.value as "auto" | "360" | "480")} style={{ padding: "2px 6px", borderRadius: 6 }}>
            <option value="auto">自动</option>
            <option value="360">360p</option>
            <option value="480">480p</option>
          </select>
          <label htmlFor="sel-vtt" style={{ fontSize: 12, color: "#6b7280" }}>帧预览</label>
          <select id="sel-vtt" value={vttMode} onChange={(e) => setVttMode(e.target.value as "auto" | "sprite" | "frame")} style={{ padding: "2px 6px", borderRadius: 6 }}>
            <option value="auto">自动</option>
            <option value="sprite">雪碧图</option>
            <option value="frame">逐帧</option>
          </select>
          <button onClick={() => load(null)} disabled={loading} style={{ background: "#f3f4f6", padding: "6px 10px", borderRadius: 6, cursor: loading ? "not-allowed" : "pointer" }}>刷新</button>
        </div>
      </div>

      {error && (<div style={{ marginTop: 8, color: "#991b1b" }}>{error}</div>)}

      <div style={{ height: 0, overflow: "hidden" }} aria-hidden>
        {items.slice(0, prefetchCount).map((it) => {
          const fallback = `/api/s3/proxy?key=${encodeURIComponent(it.key)}&expires=600`;
          const preview = it.preview360Url || it.previewUrl || fallback;
          return <link key={it.key} rel="prefetch" href={preview} as="video" />;
        })}
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(480px, 1fr))", gap: 20 }}>
        {items.map((it) => {
          const playing = openedKey === it.key;
          const fallback = `/api/s3/proxy?key=${encodeURIComponent(it.key)}&expires=600`;
          const preview480 = it.previewUrl || fallback;
          const preview360 = it.preview360Url || it.previewUrl || fallback;
          return (
            <div key={it.key} style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#000", aspectRatio: "16/9" }}>
              {playing ? (
                <VideoPlayer
                  src={it.hlsUrl || it.url}
                  storageId={it.key}
                  poster={it.posterUrl || undefined}
                  expiresAt={Date.now() + expires * 1000}
                  thumbsBase={it.thumbsBase || undefined}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                  onRequestRefreshUrl={async () => {
                    const u = new URL("/api/s3/signed-url", window.location.origin);
                    u.searchParams.set("key", it.key);
                    u.searchParams.set("expires", String(expires));
                    const res = await fetch(u.toString());
                    if (!res.ok) throw new Error(await res.text());
                    const data = (await res.json()) as { url: string };
                    return data.url;
                  }}
                />
              ) : (
                <HoverVideo
                  src={it.url}
                  previewSrc={preview480}
                  preview360Src={preview360}
                  animSrc={it.animUrl || undefined}
                  thumbsBase={it.thumbsBase || undefined}
                  poster={it.posterUrl || undefined}
                  previewStrategy={previewStrategy}
                  vttMode={vttMode}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                  onClick={() => setOpenedKey(it.key)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
        {nextToken && (
          <button onClick={() => load(nextToken)} disabled={loading} style={{ background: "#111827", color: "white", padding: "8px 12px", borderRadius: 6, cursor: loading ? "not-allowed" : "pointer" }}>加载更多</button>
        )}
      </div>
    </section>
  );
} 