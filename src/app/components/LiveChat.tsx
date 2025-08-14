"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
type CommentItem = { id: string; userId: string; content: string; createdAt: string };
import data from '@emoji-mart/data';
import dynamic from "next/dynamic";
const EmojiPicker = dynamic(() => import('@emoji-mart/react'), { ssr: false });
export default function LiveChat({ roomId }: { roomId: string }) {
  const [items, setItems] = useState<CommentItem[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);

  // minimal guest id for demo
  const userId = useMemo(() => {
    if (typeof window === "undefined") return "guest";
    const k = "guestId";
    let v = window.localStorage.getItem(k);
    if (!v) { v = `g_${Math.random().toString(36).slice(2, 10)}`; window.localStorage.setItem(k, v); }
    return v;
  }, []);

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/comments?videoId=${encodeURIComponent(roomId)}&limit=200`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const list: CommentItem[] = data.items || [];
      setItems(list);
      // scroll to bottom
      setTimeout(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, [roomId]);

  useEffect(() => {
    // initial history
    fetchComments();
    // realtime via WS (direct to comments-service WS port)
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    function open(url: string) {
      try {
        ws = new WebSocket(url);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
            if (msg?.type === 'comment' && msg.item) {
              setItems((prev) => {
                const exists = prev.some((x) => x.id === msg.item.id);
                if (exists) return prev;
                return [...prev, msg.item].slice(-200);
              });
              setTimeout(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, 0);
            }
          } catch { }
        };
        ws.onclose = ws.onerror = () => {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 1000);
        };
      } catch { /* will retry */ }
    }
    function connect() {
      const isHttps = typeof location !== 'undefined' && location.protocol === 'https:';
      const proto = isHttps ? 'wss' : 'ws';
      const host = typeof location !== 'undefined' ? location.hostname : 'localhost';
      const direct = `${proto}://${host}:${process.env.NEXT_PUBLIC_COMMENTS_WS_PORT || '4002'}/?roomId=${encodeURIComponent(roomId)}`;
      // Chrome 对同源代理的 WS 升级不稳定，改为强制直连 WS 端口
      open(direct);
    }
    connect();
    return () => { if (ws) try { ws.close(); } catch { } ws = null; if (reconnectTimer) clearTimeout(reconnectTimer); };
  }, [fetchComments, roomId]);

  const send = useCallback(async () => {
    const content = text.trim();
    if (!content) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: roomId, userId, content })
      });
      if (!res.ok) throw new Error(await res.text());
      setText("");
      setShowEmoji(false);
      fetchComments();
    } catch (e) { setError(e instanceof Error ? e.message : 'send failed'); }
    finally { setLoading(false); }
  }, [roomId, userId, text, fetchComments]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  const insertEmoji = useCallback((e: string) => {
    const el = inputRef.current;
    if (!el) { setText((t) => t + e); return; }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const nt = text.slice(0, start) + e + text.slice(end);
    setText(nt);
    setTimeout(() => { try { el.focus(); el.setSelectionRange(start + e.length, start + e.length); } catch { } }, 0);
  }, [text]);

  // UI: black & white, simple lines
  return (
    <div className="h-full w-full grid grid-rows-[1fr_auto] bg-white text-black border border-black rounded-md">
      <div ref={listRef} className="overflow-y-auto p-3 space-y-2">
        {items.map((it) => (
          <div key={it.id} className="border-b border-black/20 pb-2">
            <div className="text-xs text-black/60">{it.userId} · {new Date(it.createdAt).toLocaleTimeString()}</div>
            <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">{it.content}</div>
          </div>
        ))}
        {items.length === 0 && (<div className="text-center text-sm text-black/50 select-none">暂无评论</div>)}
      </div>
      <div className="relative border-t border-black/40 p-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowEmoji((v) => !v)}
            className="h-9 px-3 border border-black rounded-sm bg-white text-black"
            title="表情"
            aria-label="选择表情"
          >🙂</button>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="说点什么…"
            className="flex-1 h-9 px-3 outline-none border border-black rounded-sm bg-white text-black placeholder-black/40"
          />
          <button
            onClick={send}
            disabled={loading || !text.trim()}
            className="h-9 px-3 border border-black rounded-sm bg-white text-black disabled:opacity-40"
          >发送</button>
        </div>
        {showEmoji && (
          <div className="absolute bottom-12 left-2 z-10 border border-black bg-white rounded-sm p-2">
            <EmojiPicker
              data={data}
              onEmojiSelect={(e: { native?: string }) => { if (e?.native) insertEmoji(e.native); }}
              theme="light"
              previewPosition="none"
              skinTonePosition="none"
              navPosition="bottom"
              searchPosition="top"
            />
          </div>
        )}
        {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
      </div>
    </div>
  );
}


