export const runtime = 'edge';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomId = url.searchParams.get('roomId') || '';
  const targetBase = process.env.COMMENTS_BASE || 'http://localhost:4001';

  const target = `${targetBase.replace(/\/$/, '')}/ws?roomId=${encodeURIComponent(roomId)}`;
  const upgradeHeader = request.headers.get('upgrade') || '';
  if (upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response('Expected websocket', { status: 400 });
  }

  // @ts-expect-error edge fetch supports upgrade
  const res = await fetch(target, { headers: request.headers });
  return res;
}
