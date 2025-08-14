"use client";
import { useState } from 'react';

export default function LiveCreatePage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resp, setResp] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      const token =
        typeof window !== "undefined" ? localStorage.getItem("token") || "" : "";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch("/api/live?action=create", {
        method: "POST",
        headers,
        body: JSON.stringify({ title, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "创建失败");
      setResp(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 640, display: 'grid', gap: 12 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>创建直播</h1>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" style={{ padding: 8, border: '1px solid #ddd', borderRadius: 8 }} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="描述（可选）" rows={3} style={{ padding: 8, border: '1px solid #ddd', borderRadius: 8 }} />
      <button onClick={submit} disabled={loading} style={{ padding: '8px 12px', borderRadius: 8, background: '#2563eb', color: '#fff' }}>{loading ? '创建中...' : '创建'}</button>
      {resp && (
        <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
          <div><b>直播ID：</b>{resp.id}</div>
          <div><b>推流密钥（RTMP Stream Key）：</b>{resp.ingestKey}</div>
          <div><b>状态：</b>{resp.status}</div>
          <div><b>播放ID：</b>{resp.playbackId || '-'}</div>
          <div style={{ marginTop: 8 }}>
            <a href={`/live/${encodeURIComponent(resp.id)}`} style={{ color: '#2563eb' }}>前往观看页</a>
          </div>
        </div>
      )}
    </div>
  );
}


