import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { HttpsProxyAgent } from "https-proxy-agent";
import jwt, { JwtPayload } from "jsonwebtoken";

export const runtime = "nodejs";

const AWS_REGION = process.env.AWS_REGION;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const USE_ACCELERATE = process.env.S3_ACCELERATE === "1";

function createS3Client(): S3Client {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  let requestHandler: NodeHttpHandler | undefined;
  if (proxy) {
    const agent = new HttpsProxyAgent(proxy);
    requestHandler = new NodeHttpHandler({
      httpAgent: agent,
      httpsAgent: agent,
      connectionTimeout: 5000,
      socketTimeout: 15000,
    });
  } else {
    requestHandler = new NodeHttpHandler({
      connectionTimeout: 5000,
      socketTimeout: 15000,
    });
  }

  return new S3Client({
    region: AWS_REGION,
    requestHandler,
    useAccelerateEndpoint: USE_ACCELERATE,
  });
}

const s3Client = createS3Client();

export async function POST(request: Request) {
  try {
    if (!AWS_REGION || !S3_BUCKET_NAME) {
      return new Response(
        JSON.stringify({ error: "Missing AWS_REGION or S3_BUCKET_NAME env" }),
        { status: 500 }
      );
    }

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
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const body = await request.json();
    const { path, folderName } = body;

    if (!folderName) {
      return new Response(JSON.stringify({ error: "folderName is required" }), { status: 400 });
    }

    const basePrefix = `uploads/users/${userId}/videos/`;
    const currentPrefix = path ? `${basePrefix}${path}` : basePrefix;
    const key = `${currentPrefix}${folderName}/`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: key,
        Body: "",
      })
    );

    return Response.json({ success: true, key });

  } catch (error: unknown) {
    console.error("[folders][POST] error", error);
    const message = error instanceof Error ? error.message : "Failed to create folder";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    if (!AWS_REGION || !S3_BUCKET_NAME) {
      return new Response(
        JSON.stringify({ error: "Missing AWS_REGION or S3_BUCKET_NAME env" }),
        { status: 500 }
      );
    }

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
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const prefix = searchParams.get("prefix");

    if (!prefix) {
      return new Response(JSON.stringify({ error: "prefix is required" }), { status: 400 });
    }

    // For safety, only allow deleting empty folders first.
    // To delete a non-empty folder, you would need to list and delete all objects within it first.
    const listRes = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET_NAME,
        Prefix: prefix,
        MaxKeys: 2, // Check if there's more than just the folder placeholder itself
      })
    );

    if (listRes.Contents && listRes.Contents.length > 1) {
        return new Response(JSON.stringify({ error: "Folder is not empty" }), { status: 400 });
    }

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: prefix,
      })
    );

    return Response.json({ success: true });

  } catch (error: unknown) {
    console.error("[folders][POST] error", error);
    const message = error instanceof Error ? error.message : "Failed to create folder";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500 }
    );
  }
}
