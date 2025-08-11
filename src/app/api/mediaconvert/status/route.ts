import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

export const runtime = "nodejs";

const AWS_REGION = process.env.AWS_REGION;
const JOBS_TABLE = process.env.MEDIA_JOBS_TABLE || "yoom-media-jobs";

function createDocClient() {
  const ddb = new DynamoDBClient({ region: AWS_REGION });
  return DynamoDBDocumentClient.from(ddb);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    const key = url.searchParams.get("key");

    if (!AWS_REGION) return new Response(JSON.stringify({ error: "AWS_REGION missing" }), { status: 500 });

    const doc = createDocClient();

    if (jobId) {
      const out = await doc.send(new GetCommand({ TableName: JOBS_TABLE, Key: { jobId } }));
      if (!out.Item) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      return Response.json(out.Item);
    }

    if (key) {
      // 如果你创建了 GSI: key-updatedAt-index，这里按最新时间倒序查询一条
      const out = await doc.send(new QueryCommand({
        TableName: JOBS_TABLE,
        IndexName: "key-updatedAt-index",
        KeyConditionExpression: "#k = :k",
        ExpressionAttributeNames: { "#k": "key" },
        ExpressionAttributeValues: { ":k": key },
        ScanIndexForward: false,
        Limit: 1,
      }));
      if (!out.Items || out.Items.length === 0) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      return Response.json(out.Items[0]);
    }

    return new Response(JSON.stringify({ error: "jobId or key required" }), { status: 400 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "status failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}


