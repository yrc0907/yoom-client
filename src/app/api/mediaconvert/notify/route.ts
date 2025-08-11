import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";

const AWS_REGION = process.env.AWS_REGION;
const JOBS_TABLE = process.env.MEDIA_JOBS_TABLE || "yoom-media-jobs";
const WEBHOOK_SECRET = process.env.MC_WEBHOOK_SECRET;

function createDocClient() {
  const ddb = new DynamoDBClient({ region: AWS_REGION });
  return DynamoDBDocumentClient.from(ddb);
}

export async function POST(request: Request) {
  try {
    if (!AWS_REGION) return new Response(JSON.stringify({ error: "AWS_REGION missing" }), { status: 500 });

    // 简易鉴权：Authorization: Bearer <secret>
    if (WEBHOOK_SECRET) {
      const auth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (token !== WEBHOOK_SECRET) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      }
    }

    const body = await request.json().catch(() => ({}));
    const jobId: string | undefined = body.jobId;
    const status: string | undefined = body.status; // e.g. COMPLETE, ERROR, PROGRESSING
    const error: string | undefined = body.error;
    const hlsPrefix: string | undefined = body.hlsPrefix;
    const key: string | undefined = body.key;
    if (!jobId || !status) return new Response(JSON.stringify({ error: "jobId and status required" }), { status: 400 });

    const now = new Date().toISOString();
    const doc = createDocClient();
    const expr: string[] = ["#s = :s", "updatedAt = :t"]; // mandatory fields
    const names: Record<string, string> = { "#s": "status" };
    const values: Record<string, unknown> = { ":s": status, ":t": now };
    if (typeof error === "string") { expr.push("#e = :e"); names["#e"] = "error"; values[":e"] = error; }
    if (typeof hlsPrefix === "string") { expr.push("hlsPrefix = :h"); values[":h"] = hlsPrefix; }
    if (typeof key === "string") { expr.push("#k = :k"); names["#k"] = "key"; values[":k"] = key; }

    await doc.send(new UpdateCommand({
      TableName: JOBS_TABLE,
      Key: { jobId },
      UpdateExpression: "SET " + expr.join(", "),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));

    return Response.json({ ok: true, jobId, status, updatedAt: now });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "notify failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}


