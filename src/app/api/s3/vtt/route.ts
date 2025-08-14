import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { HttpsProxyAgent } from "https-proxy-agent";

export const runtime = "nodejs";

const AWS_REGION = process.env.AWS_REGION;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const USE_ACCELERATE = process.env.S3_ACCELERATE === "1";

function createS3Client(): S3Client {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  let requestHandler: NodeHttpHandler | undefined;
  if (proxy) {
    const agent = new HttpsProxyAgent(proxy);
    requestHandler = new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent, connectionTimeout: 8000, socketTimeout: 20000 });
  } else {
    requestHandler = new NodeHttpHandler({ connectionTimeout: 8000, socketTimeout: 20000 });
  }
  return new S3Client({ region: AWS_REGION, requestHandler, useAccelerateEndpoint: USE_ACCELERATE });
}

const s3 = createS3Client();

async function streamToString(stream: any): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks.map((u) => Buffer.from(u)));
  return buf.toString("utf-8");
}

export async function GET(request: Request) {
  try {
    if (!AWS_REGION || !S3_BUCKET_NAME) {
      return new Response(JSON.stringify({ error: "Missing AWS_REGION or S3_BUCKET_NAME env" }), { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const base = searchParams.get("base");
    if (!base) return new Response(JSON.stringify({ error: "base 必填" }), { status: 400 });
    const baseName = base.split("/").at(-1) || base;
    const fallbackInterval = Number(searchParams.get("interval") || "2");

    // 优先尝试固定位置 previews-vtt（两种命名）
    let vttKey = `previews-vtt/${baseName}-sprite.vtt`;
    let vttText: string | null = null;
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: vttKey }));
      vttText = await streamToString(res.Body as any);
    } catch { }
    if (!vttText) {
      try {
        vttKey = `previews-vtt/${baseName}.vtt`;
        const res2 = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: vttKey }));
        vttText = await streamToString(res2.Body as any);
      } catch { }
    }

    // 若没有，尝试逐帧 vtt 顶层命名
    if (!vttText) {
      try {
        vttKey = `previews-vtt/${baseName}.vtt`;
        const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: vttKey }));
        vttText = await streamToString(res.Body as any);
      } catch { }
    }

    // 若仍没有，再到 HLS 输出目录自动发现
    if (!vttText) {
      const prefixProbe = `outputs/hls/${baseName}-`;
      const list = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET_NAME, Prefix: prefixProbe, MaxKeys: 1000 }));
      const candidate = (list.Contents || []).map(o => o.Key || "").find(k => k.endsWith(".vtt"));
      if (!candidate) {
        // 动态兜底：若存在逐帧 jpg，但没有 vtt，则按固定间隔合成一个简易 vtt
        const framePrefix = `previews-vtt/${baseName}/`;
        const framesList = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET_NAME, Prefix: framePrefix, MaxKeys: 1000 }));
        const frames = (framesList.Contents || [])
          .map(o => o.Key || "")
          .filter(k => /\/(\d{3,4})\.(jpg|jpeg|png|webp)$/i.test(k))
          .sort();
        if (frames.length === 0) {
          return new Response(JSON.stringify({ error: "sprite vtt not found" }), { status: 404 });
        }
        // 合成 VTT
        let vtt = "WEBVTT\n\n";
        let t = 0;
        const step = Math.max(1, Math.min(10, fallbackInterval));
        for (const f of frames) {
          const next = t + step;
          vtt += `${fmt(t)} --> ${fmt(next)}\n/api/s3/proxy?key=${encodeURIComponent(f)}\n\n`;
          t = next;
        }
        vttText = vtt;
      } else {
        vttKey = candidate;
        const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: vttKey }));
        vttText = await streamToString(res.Body as any);
      }
    }

    const vttDir = vttKey.split("/").slice(0, -1).join("/");
    // 将图片引用统一重写为 /api/s3/proxy?key=...，无论是相对路径还是以 /previews-vtt/ 开头的绝对路径
    const rewritten = vttText!
      // 1) 绝对路径 /previews-vtt/.../*.jpg|webp
      .replace(/(^|\s)\/?previews-vtt\/(.+?\.(?:jpg|jpeg|png|webp))(#xywh=[^\s]*)?/gi, (_m, sp, rest, frag) => `${sp}/api/s3/proxy?key=${encodeURIComponent(`previews-vtt/${rest}`)}${frag || ""}`)
      // 2) 相对路径 name/001.jpg 或 thumbnails/0001.webp
      .replace(/(^|\s)([^\s#]+?\.(?:jpg|jpeg|png|webp))(#xywh=[^\s]*)?/gi, (_m, sp, img, frag) => `${sp}/api/s3/proxy?key=${encodeURIComponent(`${vttDir}/${img}`)}${frag || ""}`)
      // 3) 兼容老格式前缀 {baseName}-001.jpg
      .replaceAll(`${baseName}-`, `/api/s3/proxy?key=${encodeURIComponent(`${vttDir}/${baseName}-`)}`);

    const headers = new Headers();
    headers.set("Content-Type", "text/vtt; charset=utf-8");
    headers.set("Cache-Control", "public, max-age=300");
    return new Response(rewritten, { status: 200, headers });
  } catch (err: unknown) {
    console.error("[s3/vtt] error", err);
    const msg = err instanceof Error ? err.message : "vtt failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}

function fmt(sec: number): string {
  const s = Math.floor(sec);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}.000`;
}


