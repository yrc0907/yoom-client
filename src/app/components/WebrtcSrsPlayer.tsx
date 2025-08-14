"use client";
import { useEffect, useRef, useState } from "react";

export type WebrtcSrsPlayerProps = {
  webrtcUrl: string; // e.g. webrtc://localhost/live/stream
  apiBase?: string;  // e.g. http://localhost:1985
  style?: React.CSSProperties;
};

export default function WebrtcSrsPlayer({ webrtcUrl, apiBase, style }: WebrtcSrsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    (async () => {
      setError(null);
      try {
        const api = apiBase || process.env.NEXT_PUBLIC_SRS_HTTP_API || "http://localhost:1985";
        const srsVhost = process.env.NEXT_PUBLIC_SRS_VHOST || 'localhost';
        const isHttps = typeof location !== 'undefined' && location.protocol === 'https:';
        const schema = isHttps ? 'https' : 'http';

        const pc = new RTCPeerConnection({ iceServers: [] });
        pcRef.current = pc;
        pc.addTransceiver("audio", { direction: "recvonly" });
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.ontrack = (ev) => {
          if (stopped) return;
          const v = videoRef.current;
          if (v && ev.streams && ev.streams[0]) {
            v.srcObject = ev.streams[0];
            v.play().catch(() => { });
          }
        };

        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);

        // Parse path: webrtc://host[:port]/app/stream?...
        const path = webrtcUrl.replace(/^webrtc:\/\/[^\/?#]+/i, '');
        const app = (path.match(/^\/?([^\/?#]+)\//)?.[1]) || 'live';
        const stream = (path.match(/^\/?[^\/?#]+\/([^\/?#]+)(?:\?|$)/)?.[1]) || '';

        // 1) Try WHEP first
        try {
          const whep = await fetch(`${api}/rtc/v1/whep/?app=${encodeURIComponent(app)}&stream=${encodeURIComponent(stream)}&vhost=${encodeURIComponent(srsVhost)}&schema=${schema}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sdp: offer.sdp })
          });
          const text = await whep.text();
          if (whep.ok) {
            const resp = JSON.parse(text) as { code?: number; sdp?: string };
            if (typeof resp.code === 'undefined' || resp.code === 0) {
              if (resp.sdp && /^v=/.test(resp.sdp)) {
                await pc.setRemoteDescription({ type: 'answer', sdp: resp.sdp });
                return;
              }
            }
          }
        } catch { /* ignore and fallback */ }

        // 2) Fallback to /rtc/v1/play with canonical streamurl
        const playUrl = `webrtc://${srsVhost}/${encodeURIComponent(app)}/${encodeURIComponent(stream)}?schema=${schema}&vhost=${encodeURIComponent(srsVhost)}`;
        const res = await fetch(`${api}/rtc/v1/play/`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api: `${api}/rtc/v1/play/`, streamurl: playUrl, clientip: null, sdp: offer.sdp })
        });
        const text = await res.text();
        if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
        let data: { code?: number; sdp?: string } | unknown = {};
        try { data = JSON.parse(text) as { code?: number; sdp?: string }; } catch { throw new Error(`SRS response not JSON: ${text?.slice(0, 160)}`); }
        const d = data as { code?: number; sdp?: string };
        if (typeof d.code !== 'undefined' && d.code !== 0) throw new Error(`SRS play error code=${d.code}`);
        if (!d.sdp || !/^v=/.test(d.sdp)) throw new Error('Invalid SDP answer from SRS');
        await pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
      } catch (e: any) {
        setError(e?.message || "webrtc play failed");
      }
    })();

    return () => { stopped = true; if (pcRef.current) { try { pcRef.current.close(); } catch { } pcRef.current = null; } };
  }, [webrtcUrl, apiBase]);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <video ref={videoRef} controls playsInline muted style={{ width: "100%", background: "#000", borderRadius: 8, ...(style || {}) }} />
      {error && <div style={{ color: "#b91c1c", fontSize: 12 }}>{error}</div>}
    </div>
  );
}



