export const runtime = "nodejs";

const FEED_BASE = process.env.FEED_BASE || "http://localhost:4004";

export async function GET(request: Request) {
  const u = new URL(request.url);
  const id = u.searchParams.get('id');
  if (id) {
    const res = await fetch(`${FEED_BASE}/feeds/${encodeURIComponent(id)}`, { cache: 'no-store' });
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  }
  const res = await fetch(`${FEED_BASE}/feeds`, { cache: 'no-store' });
  return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
}

export async function POST(request: Request) {
  const u = new URL(request.url);
  const action = u.searchParams.get('action');
  const jwt = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  if (action === 'publish') {
    const res = await fetch(`${FEED_BASE}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: jwt }, body: await request.text() });
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  }
  if (action === 'reply') {
    const res = await fetch(`${FEED_BASE}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: jwt }, body: await request.text() });
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ error: 'invalid action' }), { status: 400 });
}


