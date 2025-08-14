"use client";
import VideoGallery, { ListResponse } from "@/app/components/VideoGallery";

export default function FeedPage() {
  // 直接复用首页的展示与渲染逻辑（VideoGallery），确保样式与交互完全一致
  async function listLoader(token: string | null, limit: number): Promise<ListResponse> {
    const res = await fetch('/api/feeds', { cache: 'no-store' });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    // 将发布列表映射为 VideoGallery 期望的结构（通过 key 组装 url/preview 等，由组件内部完成）
    const items = (data.items || []).map((it: any) => {
      const key = String(it.videoKey);
      const fallback = `/api/s3/proxy?key=${encodeURIComponent(key)}&expires=600`;
      const base = key.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
      return {
        key,
        url: fallback,
        hlsUrl: null,
        posterUrl: null,
        previewUrl: fallback,
        preview360Url: fallback,
        animUrl: null,
        thumbsBase: `previews-vtt/${base}`,
        size: undefined,
        lastModified: it.createdAt,
      };
    });
    return { items, nextToken: null, expires: 600 };
  }

  return (
    <div className="p-6 md:p-8">
      <h1 className="text-xl font-semibold mb-3">发布区</h1>
      <VideoGallery listLoader={listLoader} />
    </div>
  );
}


