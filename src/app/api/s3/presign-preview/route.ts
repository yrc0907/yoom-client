import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { S3Client } from "@aws-sdk/client-s3";

export const runtime = "nodejs";

const AWS_REGION = process.env.AWS_REGION;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

const s3Client = new S3Client({ region: AWS_REGION });

type Body = {
  baseName: string; // 预览基名（与视频 basename 对应）
  kind: "image" | "vtt";
  fileName?: string; // kind=image 时必填，比如 001.jpg
  contentType?: string; // 可选覆盖
  fileSize?: number;
};

export async function POST(request: Request) {
  try {
    if (!AWS_REGION || !S3_BUCKET_NAME) {
      return new Response(
        JSON.stringify({ error: "Missing AWS_REGION or S3_BUCKET_NAME env" }),
        { status: 500 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Partial<Body>;
    const baseName = body.baseName?.replace(/[^a-zA-Z0-9_-]/g, "");
    const kind = body.kind;
    const fileSize = typeof body.fileSize === "number" ? body.fileSize : undefined;
    if (!baseName || !kind) {
      return new Response(JSON.stringify({ error: "baseName, kind 必填" }), { status: 400 });
    }

    let key = "";
    const contentType = body.contentType || (kind === "image" ? "image/jpeg" : "text/vtt");
    if (kind === "image") {
      const fileName = (body.fileName || "001.jpg").replace(/[^0-9a-zA-Z_.-]/g, "");
      key = `previews-vtt/${baseName}/${fileName}`;
    } else {
      key = `previews-vtt/${baseName}.vtt`;
    }

    const maxBytes = kind === "image" ? 2 * 1024 * 1024 : 512 * 1024; // 单张2MB，VTT 512KB
    if (typeof fileSize === "number" && fileSize > maxBytes) {
      return new Response(JSON.stringify({ error: "File too large", maxBytes }), { status: 413 });
    }

    const presignedPost = await createPresignedPost(s3Client, {
      Bucket: S3_BUCKET_NAME,
      Key: key,
      Expires: 300,
      Fields: {
        key,
        "Content-Type": contentType,
      },
      Conditions: [
        ["content-length-range", 0, maxBytes],
        ["starts-with", "$Content-Type", kind === "image" ? "image/" : "text/"],
        { key },
      ],
    });

    return Response.json({ url: presignedPost.url, fields: presignedPost.fields, key, maxBytes });
  } catch (error) {
    console.error("[presign-preview] error", error);
    return new Response(JSON.stringify({ error: "Failed to create presigned post for preview" }), { status: 500 });
  }
}



