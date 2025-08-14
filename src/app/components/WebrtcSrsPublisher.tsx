"use client";
import { useEffect, useRef, useState } from "react";

export type WebrtcSrsPublisherProps = {
  webrtcUrl: string; // e.g. webrtc://localhost/live/stream
  apiBase?: string;  // e.g. http://localhost:1985
  style?: React.CSSProperties;
};

export default function WebrtcSrsPublisher({ webrtcUrl, apiBase, style }: WebrtcSrsPublisherProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (publishing) return;
    setError(null);
    try {
      const api = apiBase || process.env.NEXT_PUBLIC_SRS_HTTP_API || "http://localhost:1985";
      const isHttps = typeof location !== 'undefined' && location.protocol === 'https:';
      const schema = isHttps ? 'https' : 'http';
      const path = webrtcUrl.replace(/^webrtc:\/\/[^\/?#]+/i, ''); // /live/<stream>
      const app = (path.match(/^\/?([^\/?#]+)\//)?.[1]) || 'live';
      const stream = (path.match(/^\/?[^\/?#]+\/([^\/?#]+)(?:\?|$)/)?.[1]) || '';
      const vhost = process.env.NEXT_PUBLIC_SRS_VHOST || 'localhost';

      // Capture camera+mic
      const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = media;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = media;
        try { await localVideoRef.current.play(); } catch { /* noop */ }
      }

      const pc = new RTCPeerConnection({ iceServers: [] });
      pcRef.current = pc;
      for (const track of media.getTracks()) pc.addTrack(track, media);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 1) Try WHIP
      let answered = false;
      try {
        const whip = await fetch(`${api}/rtc/v1/whip/?app=${encodeURIComponent(app)}&stream=${encodeURIComponent(stream)}&vhost=${encodeURIComponent(vhost)}&schema=${schema}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sdp: offer.sdp })
        });
        const text = await whip.text();
        if (whip.ok) {
          const data = JSON.parse(text) as { code?: number; sdp?: string };
          if (typeof data.code === 'undefined' || data.code === 0) {
            if (data.sdp && /^v=/.test(data.sdp)) { await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp }); answered = true; }
          }
        }
      } catch { /* ignore and fallback */ }

      // 2) Fallback to /rtc/v1/publish
      if (!answered) {
        const publishUrl = `webrtc://${vhost}/${encodeURIComponent(app)}/${encodeURIComponent(stream)}?schema=${schema}&vhost=${encodeURIComponent(vhost)}`;
        const res = await fetch(`${api}/rtc/v1/publish/`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api: `${api}/rtc/v1/publish/`, streamurl: publishUrl, sdp: offer.sdp })
        });
        const text = await res.text();
        if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
        const data = JSON.parse(text) as { code?: number; sdp?: string };
        if (typeof data.code !== 'undefined' && data.code !== 0) throw new Error(`SRS publish error code=${data.code}`);
        if (!data.sdp || !/^v=/.test(data.sdp)) throw new Error('Invalid SDP answer from SRS');
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      }

      setPublishing(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'publish failed');
      await stop();
    }
  }

  async function stop() {
    setPublishing(false);
    try { if (pcRef.current) pcRef.current.close(); } catch { }
    pcRef.current = null;
    const s = streamRef.current;
    if (s) { for (const t of s.getTracks()) { try { t.stop(); } catch { } } }
    streamRef.current = null;
  }

  useEffect(() => {
    return () => { stop(); };

  }, []);

  return (
    <div style={{ display: 'grid', gap: 8, ...(style || {}) }}>
      <video ref={localVideoRef} muted playsInline controls style={{ width: '100%', background: '#000', borderRadius: 8 }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={start} disabled={publishing} style={{ padding: '6px 12px', background: '#2563eb', color: '#fff', borderRadius: 6 }}>开始推流</button>
        <button onClick={stop} disabled={!publishing} style={{ padding: '6px 12px', background: '#334155', color: '#fff', borderRadius: 6 }}>停止</button>
      </div>
      {error && <div style={{ color: '#b91c1c', fontSize: 12 }}>{error}</div>}
    </div>
  );
}


