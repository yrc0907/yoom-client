import { S3Client, ListPartsCommand, ListPartsCommandOutput } from "@aws-sdk/client-s3";
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
    requestHandler = new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent, connectionTimeout: 5000, socketTimeout: 15000 });
  } else {
    requestHandler = new NodeHttpHandler({ connectionTimeout: 5000, socketTimeout: 15000 });
  }
  return new S3Client({ region: AWS_REGION, requestHandler, useAccelerateEndpoint: USE_ACCELERATE });
}

const s3 = createS3Client();

export async function POST(request: Request) {
  try {
    if (!AWS_REGION || !S3_BUCKET_NAME) {
      return new Response(JSON.stringify({ error: "Missing AWS_REGION or S3_BUCKET_NAME env" }), { status: 500 });
    }
    const body = await request.json().catch(() => ({}));
    const key: string | undefined = body.key;
    const uploadId: string | undefined = body.uploadId;

    if (!key || !uploadId) {
      return new Response(JSON.stringify({ error: "key, uploadId 必填" }), { status: 400 });
    }

    const parts: { ETag: string; PartNumber: number; Size?: number }[] = [];
    let partNumberMarker: string | undefined = undefined;

    // 处理分页
    while (true) {
      let res: ListPartsCommandOutput;
      try {
        res = await s3.send(
          new ListPartsCommand({ Bucket: S3_BUCKET_NAME, Key: key, UploadId: uploadId, PartNumberMarker: partNumberMarker })
        ) as ListPartsCommandOutput;
      } catch (err: unknown) {
        const e = err as { name?: string; Code?: string };
        if (e?.name === "NoSuchUpload" || e?.Code === "NoSuchUpload") {
          break;
        }
        throw err;
      }
      (res.Parts || []).forEach((p) => {
        if (p.PartNumber && p.ETag) parts.push({ ETag: p.ETag.replaceAll('"', ''), PartNumber: p.PartNumber, Size: p.Size });
      });
      if (!res.IsTruncated) break;
      partNumberMarker = res.NextPartNumberMarker || undefined;
    }

    return Response.json({ parts });
  } catch (error: unknown) {
    console.error("[multipart/list] error", error);
    const msg = error instanceof Error ? error.message : "list failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
} 