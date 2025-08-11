import { SQSClient, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const sqs = new SQSClient({ region: process.env.AWS_REGION });
const ddb = new DynamoDBClient({ region: process.env.AWS_REGION });
const doc = DynamoDBDocumentClient.from(ddb);
const TABLE = process.env.MEDIA_JOBS_TABLE || "yoom-media-jobs";

export const handler = async (event) => {
  for (const rec of event.Records ?? []) {
    try {
      const body = JSON.parse(rec.body || "{}");
      const detail = body.detail || {};
      const md = detail.userMetadata || {};
      const jobId = md.yoomJobId; // 我们在创建作业时写入的
      const status = (detail.status || "").toUpperCase(); // PROGRESSING, COMPLETE, ERROR
      if (!jobId || !status) continue;

      const now = new Date().toISOString();
      const values = { ":s": status, ":t": now };
      let expr = "SET #s = :s, updatedAt = :t";
      const names = { "#s": "status" };

      if (status === "ERROR" && detail.errorMessage) {
        expr += ", #e = :e";
        names["#e"] = "error";
        values[":e"] = String(detail.errorMessage).slice(0, 1000);
      }

      await doc.send(new UpdateCommand({
        TableName: TABLE,
        Key: { jobId },
        UpdateExpression: expr,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }));
    } catch (e) {
      console.error("mc-events-to-dynamodb error", e);
    }
  }
};