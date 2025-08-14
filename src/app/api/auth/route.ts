export const runtime = "nodejs";

const AUTH_BASE = process.env.AUTH_BASE || "http://localhost:4002";

export async function POST(request: Request) {
  // proxy based on ?action=register|login
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  if (!action || !["register", "login"].includes(action)) {
    return new Response(JSON.stringify({ error: "invalid action" }), { status: 400 });
  }
  const res = await fetch(`${AUTH_BASE}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: await request.text(),
  });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
}


