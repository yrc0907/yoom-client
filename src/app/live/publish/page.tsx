"use client";
import WebrtcSrsPublisher from "@/app/components/WebrtcSrsPublisher";
import { useMemo } from "react";

export default function PublishPage() {
  const httpApi = process.env.NEXT_PUBLIC_SRS_HTTP_API || 'http://localhost:1985';
  const webrtcBase = process.env.NEXT_PUBLIC_SRS_WEBRTC_BASE || 'webrtc://localhost';

  // 示例：用户可在 URL ?key=xxx 指定 stream 名称
  const search = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const key = search?.get('key') || 'test';
  const webrtcUrl = useMemo(() => `${webrtcBase.replace(/\/$/, '')}/live/${encodeURIComponent(key)}`, [webrtcBase, key]);

  return (
    <div style={{ padding: 24, display: 'grid', gap: 12 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>浏览器直播（WebRTC 推流到 SRS）</h1>
      <div style={{ color: '#6b7280' }}>示例：访问 /live/publish?key=your_stream_key 指定推流名称。OBS/RTMP 可使用 SRS 的 RTMP 地址。</div>
      <div style={{ maxWidth: 960 }}>
        <WebrtcSrsPublisher webrtcUrl={webrtcUrl} apiBase={httpApi} />
      </div>
      <div style={{ fontSize: 12, color: '#6b7280' }}>低延迟建议：确保 SRS `rtc_server.candidate` 配置为你的公网 IP；浏览器需 HTTPS 访问；禁用代理影响。</div>
    </div>
  );
}


