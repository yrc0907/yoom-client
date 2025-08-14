"use client";
import { useState } from "react";

export default function PublishButton({ videoKey }: { videoKey: string }) {
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function publish() {
    setLoading(true); setOk(null); setErr(null);
    try {
      const jwt = localStorage.getItem('token') || '';
      const res = await fetch('/api/feeds?action=publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
        body: JSON.stringify({ videoKey })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '发布失败');
      setOk('已发布');
    } catch (e: any) { setErr(e?.message || '失败'); } finally { setLoading(false); }
  }
  return (
    <div className="flex items-center gap-2">
      <button onClick={publish} disabled={loading} className="inline-flex items-center rounded-md bg-emerald-600 text-white text-sm px-3 py-1.5 hover:bg-emerald-700">
        {loading ? '发布中...' : '发布到公开区'}
      </button>
      {ok && <span className="text-emerald-700 text-sm">{ok}</span>}
      {err && <span className="text-red-600 text-sm">{err}</span>}
    </div>
  );
}


