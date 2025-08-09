"use client";

import { useEffect, useMemo, useState } from "react";
import VideoPlayer from "@/app/components/VideoPlayer";

type VideoItem = {
  key: string;
  url: string;
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

  const limit = useMemo(() => 12, []);

  async function load(token?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/s3/videos", window.location.origin);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("expires", "600");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {items.map((it) => (
          <div key={it.key} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>{it.key.split("/").at(-1)}</div>
            <VideoPlayer
              src={it.url}
              title={it.key.split("/").at(-1)}
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
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
              <a href={it.url} target="_blank" rel="noreferrer" style={{ color: "#2563eb", fontSize: 14 }}>
                新标签打开
              </a>
              {it.lastModified && (
                <span style={{ color: "#6b7280", fontSize: 12 }}>
                  {new Date(it.lastModified).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
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