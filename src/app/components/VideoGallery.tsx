"use client";

import { useEffect, useMemo, useState } from "react";
import VideoPlayer from "@/app/components/VideoPlayer";
import HoverVideo from "@/app/components/HoverVideo";

type VideoItem = {
  key: string;
  url: string;
  hlsUrl?: string | null;
  posterUrl?: string | null;
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

  useEffect(() => {
    load(null);
  }, []);

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>已上传视频</h2>
        <button
          onClick={() => load(null)}
          disabled={loading}
          style={{
            background: "#f3f4f6",
            padding: "6px 10px",
            borderRadius: 6,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          刷新
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 8, color: "#991b1b" }}>{error}</div>
      )}

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {items.map((it) => {
          const playing = openedKey === it.key;
          return (
            <div key={it.key} style={{ borderRadius: 10, overflow: "hidden", background: "#000" }}>
              {playing ? (
                <VideoPlayer
                  src={it.hlsUrl || it.url}
                  storageId={it.key}
                  poster={it.posterUrl || undefined}
                  expiresAt={Date.now() + expires * 1000}
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
                <HoverVideo src={it.hlsUrl || it.url} poster={it.posterUrl || undefined} onClick={() => setOpenedKey(it.key)} />
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
        {nextToken && (
          <button
            onClick={() => load(nextToken)}
            disabled={loading}
            style={{
              background: "#111827",
              color: "white",
              padding: "8px 12px",
              borderRadius: 6,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            加载更多
          </button>
        )}
      </div>
    </section>
  );
}