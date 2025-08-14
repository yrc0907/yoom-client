"use client";
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import LiveChat from '@/app/components/LiveChat';

type Stream = { title: string; description?: string | null; status: string; playbackId?: string | null };

export default function Page() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params.id));
  const [s, setS] = useState<Stream | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/live?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const data: Stream = await res.json();
        if (!aborted) setS(data);
      } catch (e: unknown) { if (!aborted) setError(e instanceof Error ? e.message : '加载失败'); }
      finally { if (!aborted) setLoading(false); }
    })();
    return () => { aborted = true; };
  }, [id]);

  if (loading) return <div style={{ padding: 24 }}>加载中...</div>;
  if (error) return <div style={{ padding: 24, color: '#b91c1c' }}>{error}</div>;
  if (!s) return <div style={{ padding: 24 }}>直播不存在</div>;

  const httpApi = process.env.NEXT_PUBLIC_SRS_HTTP_API || 'http://localhost:1985';
  const srsVhost = process.env.NEXT_PUBLIC_SRS_VHOST || 'localhost';
  // 规范化 webrtc 播放地址：去除末尾斜杠与端口，避免 SRS 400
  const rawUrl = (s.playbackId || '').replace(/\/?$/, '');
  // 去掉 webrtc://host:port 中的 :port，避免 SRS 400
  const webrtcUrl = rawUrl.replace(/^(webrtc:\/\/[^\/:]+):\d+(\/)/i, '$1$2');

  function RtcPlayer({ url, api }: { url: string; api: string }) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const [err, setErr] = useState<string | null>(null);
    useEffect(() => {
      let stopped = false;
      (async () => {
        setErr(null);
        try {
          const pc = new RTCPeerConnection({ iceServers: [] });
          pcRef.current = pc;
          pc.addTransceiver('audio', { direction: 'recvonly' });
          pc.addTransceiver('video', { direction: 'recvonly' });
          pc.ontrack = (ev) => {
            if (stopped) return;
            const v = videoRef.current;
            if (v && ev.streams && ev.streams[0]) { v.srcObject = ev.streams[0]; v.play().catch(() => { }); }
          };
          const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
          await pc.setLocalDescription(offer);
          // 参考官方文档：先用 WHEP，失败再用 /rtc/v1/play
          const isHttps = typeof location !== 'undefined' && location.protocol === 'https:';
          const schema = isHttps ? 'https' : 'http';
          const path = url.replace(/^webrtc:\/\/[^\/?#]+/i, ''); // /live/<stream>[?...]
          const app = (path.match(/^\/?([^\/?#]+)\//)?.[1]) || 'live';
          const stream = (path.match(/^\/?[^\/?#]+\/([^\/?#]+)(?:\?|$)/)?.[1]) || '';

          // 1) WHEP
          try {
            const whep = await fetch(`${api}/rtc/v1/whep/?app=${encodeURIComponent(app)}&stream=${encodeURIComponent(stream)}&vhost=${encodeURIComponent(srsVhost)}&schema=${schema}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sdp: offer.sdp })
            });
            const text = await whep.text();
            if (whep.ok) {
              const data = JSON.parse(text) as { code?: number; sdp?: string };
              if (typeof data.code === 'undefined' || data.code === 0) {
                if (data.sdp && /^v=/.test(data.sdp)) { await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp }); return; }
              }
            }
          } catch { /* ignore */ }

          // 2) /rtc/v1/play 固定且规范的 streamurl
          const playUrl = `webrtc://${srsVhost}/${encodeURIComponent(app)}/${encodeURIComponent(stream)}?schema=${schema}&vhost=${encodeURIComponent(srsVhost)}`;
          const res = await fetch(`${api}/rtc/v1/play/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api: `${api}/rtc/v1/play/`, streamurl: playUrl, clientip: null, sdp: offer.sdp }) });
          const text = await res.text();
          if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
          let data: { code?: number; sdp?: string } | unknown = {};
          try { data = JSON.parse(text) as { code?: number; sdp?: string }; } catch { throw new Error(`SRS response not JSON: ${text?.slice(0, 120)}`); }
          const d = data as { code?: number; sdp?: string };
          if (typeof d.code !== 'undefined' && d.code !== 0) throw new Error(`SRS play error code=${d.code}`);
          if (!d.sdp || !/^v=/.test(d.sdp)) throw new Error('Invalid SDP answer from SRS');
          await pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
        } catch (e: unknown) { setErr(e instanceof Error ? e.message : 'webrtc play failed'); }
      })();
      return () => { stopped = true; if (pcRef.current) { try { pcRef.current.close(); } catch { } pcRef.current = null; } };
    }, [url, api]);
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        <video ref={videoRef} controls playsInline muted style={{ width: '100%', background: '#000', borderRadius: 8 }} />
        {err && <div style={{ color: '#b91c1c', fontSize: 12 }}>{err}</div>}
      </div>
    );
  }
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-2">{s.title} · RTC</h1>
      <div className="text-black/60 mb-3">{s.description || ''}</div>
      <div className="mb-4">状态：{s.status}</div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
        <div className="min-w-0">
          <RtcPlayer url={webrtcUrl} api={httpApi} />
        </div>
        <div className="h-[560px]">
          <LiveChat roomId={id} />
        </div>
      </div>
    </div>
  );
}


