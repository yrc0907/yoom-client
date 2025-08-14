import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { S3Client } from "@aws-sdk/client-s3";
import jwt, { JwtPayload } from "jsonwebtoken";

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
    const preferBaseName: string | undefined = body.baseName; // 可选：指定基名

    if (!fileName || !fileType) {
      return new Response(
        JSON.stringify({ error: "fileName and fileType are required" }),
        { status: 400 }
      );
    }

    if (!fileType.startsWith("image/")) {
      return new Response(
        JSON.stringify({ error: "Only image uploads are allowed" }),
        { status: 400 }
      );
    }

    // restrict by userId
    const auth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const secret = process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET || "dev-secret";
    let userId: string | null = null;
    try {
      if (bearer) {
        const decoded = jwt.verify(bearer, secret) as JwtPayload & { sub?: string };
        userId = decoded?.sub ? String(decoded.sub) : null;
      }
    } catch { }
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

    const datePart = new Date().toISOString().slice(0, 10);
    const sanitized = sanitizeFileName(fileName);
    const ext = getFileExtension(sanitized) || ".jpg";
    const base = (preferBaseName || sanitized).replace(/\.[^.]+$/, "");
    const key = `uploads/users/${userId}/posters/${base}${ext}`; // 用户隔离

    const maxBytes = 10 * 1024 * 1024; // 10MB
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
      },
      Conditions: [
        ["content-length-range", 0, maxBytes],
        ["starts-with", "$Content-Type", "image/"],
        { key },
      ],
    });

    return Response.json({
      url: presignedPost.url,
      fields: presignedPost.fields,
      key,
      maxBytes,
    });
  } catch (error) {
    console.error("[presign-image] error", error);
    return new Response(
      JSON.stringify({ error: "Failed to create presigned post for image" }),
      { status: 500 }
    );
  }
} 