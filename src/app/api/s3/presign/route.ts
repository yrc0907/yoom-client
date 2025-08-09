import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { S3Client } from "@aws-sdk/client-s3";

export const runtime = "nodejs";

const AWS_REGION = process.env.AWS_REGION;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

const s3Client = new S3Client({ region: AWS_REGION });

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "");
}

function getFileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  if (index === -1) return "";
  return name.slice(index).slice(0, 10);
}

export async function POST(request: Request) {
  try {
    if (!AWS_REGION || !S3_BUCKET_NAME) {
      return new Response(
        JSON.stringify({ error: "Missing AWS_REGION or S3_BUCKET_NAME env" }),
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const fileName: string | undefined = body.fileName;
    const fileType: string | undefined = body.fileType;
    const fileSize: number | undefined = body.fileSize;

    if (!fileName || !fileType) {
      return new Response(
        JSON.stringify({ error: "fileName and fileType are required" }),
        { status: 400 }
      );
    }

    if (!fileType.startsWith("video/")) {
      return new Response(
        JSON.stringify({ error: "Only video uploads are allowed" }),
        { status: 400 }
      );
    }

    const datePart = new Date().toISOString().slice(0, 10);
    const ext = getFileExtension(sanitizeFileName(fileName));
    const key = `uploads/videos/${datePart}/${crypto.randomUUID()}${ext}`;

    const maxBytes = 1024 * 1024 * 1024; // 1GB
    if (typeof fileSize === "number" && fileSize > maxBytes) {
      return new Response(
        JSON.stringify({ error: "File too large", maxBytes }),
        { status: 413 }
      );
    }

    const presignedPost = await createPresignedPost(s3Client, {
      Bucket: S3_BUCKET_NAME,
      Key: key,
      Expires: 300,
      Fields: {
        key,
        "Content-Type": fileType,
        // 可选：强制 201，便于调试
        // success_action_status: "201",
      },
      Conditions: [
        ["content-length-range", 0, maxBytes],
        ["starts-with", "$Content-Type", "video/"],
        { key },
      ],
    });

    // 日志（仅开发期有用）
    console.log("[presign] region=", AWS_REGION, "bucket=", S3_BUCKET_NAME, "url=", presignedPost.url);

    return Response.json({
      url: presignedPost.url,
      fields: presignedPost.fields,
      key,
      maxBytes,
      debug: { region: AWS_REGION, bucket: S3_BUCKET_NAME },
    });
  } catch (error) {
    console.error("[presign] error", error);
    return new Response(
      JSON.stringify({ error: "Failed to create presigned post" }),
      { status: 500 }
    );
  }
} 