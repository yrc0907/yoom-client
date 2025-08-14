"use client";
import { useCallback, useMemo, useState } from "react";

export type IngestInfoProps = {
  ingestKey: string;
  streamId?: string;
};

export default function IngestInfo({ ingestKey, streamId }: IngestInfoProps) {
  const webrtcBase = process.env.NEXT_PUBLIC_SRS_WEBRTC_BASE || 'webrtc://localhost';
  const httpApi = process.env.NEXT_PUBLIC_SRS_HTTP_API || 'http://localhost:1985';
  const srsVhost = process.env.NEXT_PUBLIC_SRS_VHOST || 'localhost';
  const srsHost = useMemo(() => {
    try { return new URL(webrtcBase).host || 'localhost'; } catch { return 'localhost'; }
  }, [webrtcBase]);

  const rtmpUrl = `rtmp://${srsHost.split(':')[0]}:1935/live?vhost=${encodeURIComponent(srsVhost)}`;
  const webrtcPlay = `${webrtcBase.replace(/\/$/, '')}/live/${encodeURIComponent(ingestKey)}`;
  const browserPublish = `/live/publish?key=${encodeURIComponent(ingestKey)}`;
  const detailsUrl = streamId ? `/live/${encodeURIComponent(streamId)}` : undefined;
  const rtcUrl = streamId ? `/live/${encodeURIComponent(streamId)}/rtc` : undefined;
  const whipUrl = `${httpApi.replace(/\/$/, '')}/rtc/v1/whip/?app=live&stream=${encodeURIComponent(ingestKey)}&vhost=${encodeURIComponent(srsVhost)}&schema=${typeof location !== 'undefined' && location.protocol === 'https:' ? 'https' : 'http'}`;

  const [copied, setCopied] = useState<string>("");
  const copy = useCallback(async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(""), 1200); } catch { }
  }, []);

  return (
    <div className="rounded-lg border border-slate-200 p-4 grid gap-3 bg-white">
      <div className="text-sm text-slate-600">推流地址（OBS 等外部软件）：</div>
      <div className="flex items-center gap-2 text-sm">
        <span className="font-mono">{rtmpUrl}</span>
        <button onClick={() => copy(rtmpUrl, 'rtmp')} className="text-xs px-2 py-1 rounded bg-slate-100">复制</button>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span>Stream Key：</span>
        <span className="font-mono">{ingestKey}</span>
        <button onClick={() => copy(ingestKey, 'key')} className="text-xs px-2 py-1 rounded bg-slate-100">复制</button>
      </div>

      <div className="h-px bg-slate-200 my-1" />

      <div className="text-sm text-slate-600">浏览器直接推流（WebRTC）：</div>
      <div className="flex items-center gap-2 text-sm">
        <a href={browserPublish} className="text-primary underline">{browserPublish}</a>
        <button onClick={() => copy(browserPublish, 'browser')} className="text-xs px-2 py-1 rounded bg-slate-100">复制</button>
      </div>

      <div className="text-sm text-slate-600">OBS WebRTC 推流（WHIP 插件）：</div>
      <div className="flex items-center gap-2 text-sm">
        <span className="font-mono truncate">{whipUrl}</span>
        <button onClick={() => copy(whipUrl, 'whip')} className="text-xs px-2 py-1 rounded bg-slate-100">复制</button>
      </div>

      <div className="h-px bg-slate-200 my-1" />

      <div className="text-sm text-slate-600">WebRTC 播放（低延迟）：</div>
      <div className="grid gap-1 text-sm">
        <div className="flex items-center gap-2">
          <span>播放 URL：</span>
          <span className="font-mono">{webrtcPlay}</span>
          <button onClick={() => copy(webrtcPlay, 'play')} className="text-xs px-2 py-1 rounded bg-slate-100">复制</button>
        </div>
        {detailsUrl && (
          <div className="flex items-center gap-3">
            <a href={detailsUrl} className="text-primary underline">详情页</a>
            <a href={rtcUrl} className="text-primary underline">RTC 播放页</a>
          </div>
        )}
      </div>

      <div className="text-xs text-slate-500 mt-2">SRS HTTP API：{httpApi}</div>
    </div>
  );
}


