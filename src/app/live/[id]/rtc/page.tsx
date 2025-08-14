import WebrtcSrsPlayer from '../../../components/WebrtcSrsPlayer';

type Stream = { title: string; description?: string | null; status: string; ingestKey?: string | null; playbackId?: string | null };

async function fetchStream(id: string): Promise<Stream | null> {
  const base = process.env.NEXT_PUBLIC_APP_ORIGIN || '';
  const u = new URL(`/api/live?id=${encodeURIComponent(id)}`, base || 'http://localhost:3000');
  const res = await fetch(u.toString(), { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function Page({ params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id);
  const s = await fetchStream(id);
  if (!s) return <div style={{ padding: 24 }}>直播不存在</div>;

  // SRS webrtc 播放地址推导：webrtc://<host>/live/<stream>
  // 假设与你的 RTMP/HLS 同一个 <ingestKey>，这里允许用户把 HLS 基础域替换为 SRS 域
  const httpApi = process.env.NEXT_PUBLIC_SRS_HTTP_API || 'http://localhost:1985';
  const webrtcBase = process.env.NEXT_PUBLIC_SRS_WEBRTC_BASE || 'webrtc://localhost';

  // 从 playbackId 推导 stream key（末尾去掉 .m3u8），或者从描述里拿 ingestKey
  let streamName = '';
  if (s.playbackId) {
    const u = new URL(s.playbackId);
    streamName = u.pathname.replace(/^\/+|\/+$/g, '').replace(/^live\//, '').replace(/\.m3u8.*$/, '');
  } else if (s.ingestKey) {
    streamName = s.ingestKey;
  }
  const webrtcUrl = `${webrtcBase.replace(/\/$/, '')}/live/${streamName}`;

  return (
    <div style={{ padding: 24, display: 'grid', gap: 12 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>{s.title} · RTC</h1>
      <div style={{ color: '#6b7280' }}>{s.description || ''}</div>
      <WebrtcSrsPlayer webrtcUrl={webrtcUrl} apiBase={httpApi} />
    </div>
  );
}


