export const runtime = "nodejs";
const AUTH_BASE = process.env.AUTH_BASE || "http://localhost:4002";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const id = decodeURIComponent(params.id);
    const res = await fetch(`${AUTH_BASE}/users/${encodeURIComponent(id)}`, { cache: "no-store" });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}


