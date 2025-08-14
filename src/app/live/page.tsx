"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import HoverVideo from "@/app/components/HoverVideo";
import IngestInfo from "@/app/components/IngestInfo";

type Live = { id: string; title: string; description?: string | null; status: string; playbackId?: string | null; ingestKey: string; authorId: string };

export default function LiveListPage() {
  const [items, setItems] = useState<Live[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch('/api/live?live=1', { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const data: { items?: Live[] } = await res.json();
        setItems(data.items ?? []);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '加载失败';
        setError(msg);
      } finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">直播区</h1>
        <Link href="/live/create" className="text-primary">创建直播</Link>
      </div>
      {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((it) => {
          const key = it.playbackId ? it.playbackId : it.id;
          const src = it.playbackId ? it.playbackId : '';
          const base = key;
          const fallback = "/placeholder.mp4"; // 可替换为宣传片或空白
          return (
            <div key={it.id} className="relative rounded-xl overflow-hidden bg-black aspect-video">
              <HoverVideo
                src={fallback}
                previewSrc={fallback}
                preview360Src={fallback}
                thumbsBase={`previews-vtt/${base}`}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                onClick={() => { window.location.assign(`/live/${encodeURIComponent(it.id)}`); }}
              />
              <div className="absolute left-0 right-0 bottom-0 p-2 bg-gradient-to-t from-black/60 to-transparent text-white text-xs">
                <div className="truncate">{it.title}</div>
                <div className="opacity-80">{it.status} · by {it.authorId}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-8 grid gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">如何推流</h2>
          <Link href="/live/create" className="text-primary">创建新的直播</Link>
        </div>
        {items.map((it) => (
          <div key={`ingest-${it.id}`} className="grid gap-2">
            <div className="text-sm text-slate-600">{it.title}（ID: {it.id}）</div>
            <IngestInfo ingestKey={it.ingestKey} streamId={it.id} />
          </div>
        ))}
      </div>
      {!loading && items.length === 0 && <div className="text-slate-500">暂无正在直播</div>}
    </div>
  );
}


