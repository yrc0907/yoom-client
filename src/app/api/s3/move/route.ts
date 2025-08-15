import { S3Client, CopyObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { HttpsProxyAgent } from "https-proxy-agent";
import jwt, { JwtPayload } from "jsonwebtoken";

export const runtime = "nodejs";

const AWS_REGION = process.env.AWS_REGION;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const USE_ACCELERATE = process.env.S3_ACCELERATE === "1";

const agent = process.env.HTTPS_PROXY ? new HttpsProxyAgent(process.env.HTTPS_PROXY) : undefined;

const s3Client = new S3Client({
  region: AWS_REGION,
  useAccelerateEndpoint: USE_ACCELERATE,
  ...(agent && { requestHandler: new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent }) }),
});

// Helper function to move a single object
async function moveObject(sourceKey: string, destKey: string) {
  if (!S3_BUCKET_NAME) throw new Error("S3_BUCKET_NAME is not set");
  await s3Client.send(new CopyObjectCommand({
    Bucket: S3_BUCKET_NAME,
    CopySource: `${S3_BUCKET_NAME}/${sourceKey}`,
    Key: destKey,
  }));
  await s3Client.send(new DeleteObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: sourceKey,
  }));
}

// Helper function to move a directory (prefix)
async function moveDirectory(sourcePrefix: string, destPrefix: string) {
  if (!S3_BUCKET_NAME) throw new Error("S3_BUCKET_NAME is not set");

  const listRes = await s3Client.send(new ListObjectsV2Command({
    Bucket: S3_BUCKET_NAME,
    Prefix: sourcePrefix,
  }));

  if (!listRes.Contents || listRes.Contents.length === 0) return; // Nothing to move

  const moves = listRes.Contents.map(obj => {
    const sourceKey = obj.Key!;
    const destKey = destPrefix + sourceKey.substring(sourcePrefix.length);
    return moveObject(sourceKey, destKey);
  });

  await Promise.all(moves);
}

export async function POST(request: Request) {
  try {
    if (!AWS_REGION || !S3_BUCKET_NAME) {
      return new Response(JSON.stringify({ error: "Missing AWS_REGION or S3_BUCKET_NAME env" }), { status: 500 });
    }

    const auth = request.headers.get("authorization") || "";
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

    const { sourceKey, destinationPrefix } = await request.json();
    if (!sourceKey || destinationPrefix === undefined) {
      return new Response(JSON.stringify({ error: "sourceKey and destinationPrefix are required" }), { status: 400 });
    }

    const userVideosPrefix = `uploads/users/${userId}/videos/`;
    if (!sourceKey.startsWith(userVideosPrefix)) {
        return new Response(JSON.stringify({ error: "Invalid source key" }), { status: 403 });
    }

    const fileName = sourceKey.split('/').pop();
    const destKey = `${destinationPrefix}${fileName}`;

    // 1. Move the main video file
    await moveObject(sourceKey, destKey);

    // 2. Move associated files
    const baseKey = fileName.replace(/\.[^/.]+$/, "");
    const derivedPrefixes = {
        hls: `uploads/users/${userId}/hls/`,
        thumbs: `uploads/users/${userId}/thumbs/`,
        preview: `uploads/users/${userId}/preview/`,
    };

    // Move HLS directory
    await moveDirectory(`${derivedPrefixes.hls}${baseKey}/`, `${derivedPrefixes.hls}${destinationPrefix.substring(userVideosPrefix.length)}${baseKey}/`);

    // Move other derived files (previews, thumbs)
    const associatedExtensions = [
        ".jpg", // poster
        ".480p.mp4", // preview
        ".360p.mp4", // preview
        ".anim.webp", // animated preview
        ".sprite.vtt", ".sprite.jpg", // vtt sprites
        ".frames.vtt", ".frames.jpg" // vtt frames
    ];

    const movePromises: Promise<void>[] = [];

    for (const ext of associatedExtensions) {
        const fromKey = `${baseKey}${ext}`;
        const newToKey = `${destinationPrefix.substring(userVideosPrefix.length)}${baseKey}${ext}`;
        
        if (ext.includes('p.mp4') || ext.includes('.webp')) { // Previews
            movePromises.push(moveObject(`${derivedPrefixes.preview}${fromKey}`, `${derivedPrefixes.preview}${newToKey}`));
        } else { // Thumbs
            movePromises.push(moveObject(`${derivedPrefixes.thumbs}${fromKey}`, `${derivedPrefixes.thumbs}${newToKey}`));
        }
    }

    await Promise.all(movePromises);

    return Response.json({ success: true, newKey: destKey });

  } catch (error: unknown) {
    console.error("[move][POST] error", error);
    const message = error instanceof Error ? error.message : "Failed to move file";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
