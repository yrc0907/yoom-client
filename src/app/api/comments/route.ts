export const runtime = "nodejs";

const COMMENTS_BASE = process.env.COMMENTS_BASE || "http://localhost:4001";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const videoId = url.searchParams.get("videoId");
    if (!videoId) return new Response(JSON.stringify({ error: "videoId required" }), { status: 400 });
    const res = await fetch(`${COMMENTS_BASE}/comments?videoId=${encodeURIComponent(videoId)}`, { cache: "no-store" });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!body?.videoId || !body?.userId || !body?.content) {
      return new Response(JSON.stringify({ error: "videoId, userId, content required" }), { status: 400 });
    }
    const res = await fetch(`${COMMENTS_BASE}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const videoId = url.searchParams.get('videoId');
    if (!videoId) return new Response(JSON.stringify({ error: 'videoId required' }), { status: 400 });
    const res = await fetch(`${COMMENTS_BASE}/comments?videoId=${encodeURIComponent(videoId)}`, { method: 'DELETE' });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'failed';
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}


