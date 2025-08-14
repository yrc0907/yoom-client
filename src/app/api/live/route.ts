export const runtime = "nodejs";
const LIVE_BASE = process.env.LIVE_BASE || "http://localhost:4003";

export async function GET(request: Request) {
  const u = new URL(request.url);
  const id = u.searchParams.get('id');
  const onlyLive = u.searchParams.get('live');

  try {
    if (id) {
      const res = await fetch(`${LIVE_BASE}/streams/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const text = await res.text();
      return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
    }

    const listUrl = new URL('/streams', LIVE_BASE);
    if (onlyLive) listUrl.searchParams.set('live', onlyLive);
    const res = await fetch(listUrl.toString(), { cache: 'no-store' });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'proxy failed';
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }
}

export async function POST(request: Request) {
  const u = new URL(request.url);
  const action = u.searchParams.get('action');
  const auth = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const common = { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) };

  if (action === 'create') {
    const res = await fetch(`${LIVE_BASE}/streams`, {
      method: 'POST',
      headers: common,
      body: await request.text(),
    });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  }

  const id = u.searchParams.get('id');
  if (action === 'status' && id) {
    const res = await fetch(`${LIVE_BASE}/streams/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      headers: common,
      body: await request.text(),
    });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'invalid action' }), { status: 400 });
}