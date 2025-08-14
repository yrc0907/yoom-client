import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";
const AWS_REGION = process.env.AWS_REGION;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const s3 = new S3Client({ region: AWS_REGION });

function parseNumber(input: string | null, fallback: number, min: number, max: number): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

async function head(key: string): Promise<boolean> {
  try { await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET_NAME, Key: key })); return true; } catch { return false; }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    const base = searchParams.get('base') || '';
    const expires = parseNumber(searchParams.get('expires'), 600, 60, 3600);
    if (!key) return new Response(JSON.stringify({ error: 'key required' }), { status: 400 });
    const b = base || key.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
    const candidates = [
      `uploads/posters/${b}.jpg`,
      `uploads/posters/${b}.png`,
    ];
    for (const k of candidates) {
      if (await head(k)) {
        const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: k }), { expiresIn: expires });
        return Response.json({ url, expires });
      }
    }
    // fallback: none
    return Response.json({ url: null });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'failed' }), { status: 500 });
  }
}


