"use client";
import { useEffect, useState } from "react";
import VideoPlayer from "@/app/components/VideoPlayer";
import PublishButton from "@/app/components/PublishButton";

type Comment = { id: string; userId: string; content: string; createdAt: string };

export default function VideoDetailClient({ videoKey }: { videoKey: string }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [userId, setUserId] = useState("guest");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [thumbsBase, setThumbsBase] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const info = new URL("/api/s3/video-by-key", window.location.origin);
        info.searchParams.set("key", videoKey);
        info.searchParams.set("expires", "600");
        info.searchParams.set("includeHls", "1");
        const jwt = localStorage.getItem("token") || "";
        const res = await fetch(info.toString(), { cache: "no-store", headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined });
        if (res.ok) {
          const data = await res.json();
          setVideoUrl(data.url);
          setThumbsBase(data.thumbsBase || null);
        }
        const cr = await fetch(`/api/comments?videoId=${encodeURIComponent(videoKey)}`, { cache: "no-store" });
        if (cr.ok) {
          const cj = await cr.json();
          setComments(cj.items || []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [videoKey]);

  async function submit() {
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: videoKey, userId, content: content.trim() }),
      });
      const res = await fetch(`/api/comments?videoId=${encodeURIComponent(videoKey)}`, { cache: "no-store" });
      const data = await res.json();
      setComments(data.items || []);
      setContent("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: 24, display: "grid", gap: 16 }}>
      <div style={{ maxWidth: 960 }}>
        {videoUrl ? (
          <VideoPlayer src={videoUrl} storageId={videoKey} thumbsBase={thumbsBase || undefined} />
        ) : (
          <div style={{ height: 360, background: "#000", borderRadius: 12 }} />
        )}
        <div style={{ marginTop: 12 }}>
          <PublishButton videoKey={videoKey} />
        </div>
      </div>
      <div style={{ maxWidth: 720, display: "grid", gap: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 18 }}>评论</div>
        <div style={{ display: "grid", gap: 8 }}>
          <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="用户ID（临时）" style={{ padding: 8, border: "1px solid #ddd", borderRadius: 8 }} />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="说点什么..." rows={3} style={{ padding: 8, border: "1px solid #ddd", borderRadius: 8 }} />
          <button onClick={submit} disabled={submitting} style={{ padding: "8px 12px", borderRadius: 8, background: "#2563eb", color: "#fff" }}>{submitting ? "提交中..." : "发布评论"}</button>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {comments.map((it) => (
            <div key={it.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: "#666" }}>
                <a href={`/user/${encodeURIComponent(it.userId)}`} style={{ color: '#2563eb' }}>{it.userId}</a>
                {' '}· {new Date(it.createdAt).toLocaleString()}
              </div>
              <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{it.content}</div>
            </div>
          ))}
          {!loading && comments.length === 0 && <div style={{ color: "#999" }}>还没有评论</div>}
        </div>
      </div>
    </div>
  );
}


