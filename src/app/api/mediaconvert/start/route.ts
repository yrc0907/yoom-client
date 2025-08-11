/* eslint-disable */
import { MediaConvertClient, CreateJobCommand, DescribeEndpointsCommand } from "@aws-sdk/client-mediaconvert";

export const runtime = "nodejs";

const AWS_REGION = process.env.AWS_REGION;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const MEDIACONVERT_ROLE_ARN = process.env.MEDIACONVERT_ROLE_ARN; // 必填：授予 MediaConvert 访问 S3 的角色
const MEDIACONVERT_QUEUE_ARN = process.env.MEDIACONVERT_QUEUE_ARN; // 可选：自定义队列
const MEDIACONVERT_ENDPOINT = process.env.MEDIACONVERT_ENDPOINT; // 可选：如未提供将自动发现

function getBaseName(key: string): string {
  const file = key.split("/").at(-1) || key;
  return file.replace(/\.[^.]+$/, "");
}

async function getOrDiscoverEndpoint(): Promise<string> {
  if (!AWS_REGION) throw new Error("AWS_REGION missing");
  if (MEDIACONVERT_ENDPOINT) return MEDIACONVERT_ENDPOINT;
  const probe = new MediaConvertClient({ region: AWS_REGION });
  const out = await probe.send(new DescribeEndpointsCommand({ MaxResults: 1 }));
  const url = out.Endpoints?.[0]?.Url;
  if (!url) throw new Error("Failed to discover MediaConvert endpoint. Open console once to activate MediaConvert in this region.");
  return url;
}

export async function POST(request: Request) {
  try {
    if (!AWS_REGION || !S3_BUCKET_NAME) {
      return new Response(JSON.stringify({ error: "Missing AWS_REGION or S3_BUCKET_NAME env" }), { status: 500 });
    }
    if (!MEDIACONVERT_ROLE_ARN) {
      return new Response(JSON.stringify({ error: "Missing MEDIACONVERT_ROLE_ARN env" }), { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const key: string | undefined = body.key;
    if (!key) return new Response(JSON.stringify({ error: "key 必填" }), { status: 400 });

    const base = getBaseName(key);
    const jobId = crypto.randomUUID();
    const inputUri = `s3://${S3_BUCKET_NAME}/${key}`;
    const hlsDest = `s3://${S3_BUCKET_NAME}/outputs/hls/${base}-${jobId}/`;

    const endpoint = await getOrDiscoverEndpoint();
    const mc = new MediaConvertClient({ region: AWS_REGION, endpoint });

    // 简化版 HLS 多码率 + 图像预览（Thumbnail TrickPlay）设置
    const jobSettings = {
      TimecodeConfig: { Source: "ZEROBASED" },
      Inputs: [
        {
          FileInput: inputUri,
        },
      ],
      OutputGroups: [
        {
          Name: "HLS",
          OutputGroupSettings: {
            Type: "HLS_GROUP_SETTINGS",
            HlsGroupSettings: {
              Destination: hlsDest,
              SegmentLength: 4,
              MinSegmentLength: 0,
              ManifestCompression: "NONE",
              ManifestDurationFormat: "INTEGER",
              ClientCache: "ENABLED",
              IndexNSegments: 5,
              ProgramDateTime: "EXCLUDE",
              TimedMetadataId3Frame: "NONE",
              TimedMetadataId3Period: 0,
              CodecSpecification: "RFC_4281",
              OutputSelection: "MANIFESTS_AND_SEGMENTS",
              SegmentControl: "SEGMENTED_FILES",
              ImageBasedTrickPlay: "THUMBNAIL",
              ImageBasedTrickPlaySettings: {
                IntervalCadence: "FOLLOW_CUSTOM",
                ThumbnailInterval: 2,
                ThumbnailWidth: 240, // even
                ThumbnailHeight: 144, // even (multiple of 2)
                TileWidth: 5,
                TileHeight: 5,
              },
            },
          },
          Outputs: [
            // 360p（优先可播）
            {
              NameModifier: "_360p",
              VideoDescription: {
                Width: 640,
                Height: 360,
                CodecSettings: {
                  Codec: "H_264",
                  H264Settings: {
                    RateControlMode: "QVBR",
                    QvbrQuality: 7,
                    MaxBitrate: 1_000_000,
                    CodecProfile: "MAIN",
                    CodecLevel: "AUTO",
                    GopSize: 48,
                    GopSizeUnits: "FRAMES",
                    GopClosedCadence: 1,
                    NumberBFramesBetweenReferenceFrames: 3,
                    SceneChangeDetect: "TRANSITION_DETECTION",
                  },
                },
              },
              AudioDescriptions: [
                {
                  CodecSettings: {
                    Codec: "AAC",
                    AacSettings: { Bitrate: 128000, CodingMode: "CODING_MODE_2_0", SampleRate: 48000 },
                  },
                },
              ],
              ContainerSettings: { Container: "M3U8" },
            },
            // 480p
            {
              NameModifier: "_480p",
              VideoDescription: {
                Width: 854,
                Height: 480,
                CodecSettings: {
                  Codec: "H_264",
                  H264Settings: {
                    RateControlMode: "QVBR",
                    QvbrQuality: 7,
                    MaxBitrate: 2_000_000,
                    CodecProfile: "MAIN",
                    CodecLevel: "AUTO",
                    GopSize: 48,
                    GopSizeUnits: "FRAMES",
                    GopClosedCadence: 1,
                    NumberBFramesBetweenReferenceFrames: 3,
                    SceneChangeDetect: "TRANSITION_DETECTION",
                  },
                },
              },
              AudioDescriptions: [
                {
                  CodecSettings: {
                    Codec: "AAC",
                    AacSettings: { Bitrate: 128000, CodingMode: "CODING_MODE_2_0", SampleRate: 48000 },
                  },
                },
              ],
              ContainerSettings: { Container: "M3U8" },
            },
            // 720p
            {
              NameModifier: "_720p",
              VideoDescription: {
                Width: 1280,
                Height: 720,
                CodecSettings: {
                  Codec: "H_264",
                  H264Settings: {
                    RateControlMode: "QVBR",
                    QvbrQuality: 7,
                    MaxBitrate: 4_500_000,
                    CodecProfile: "MAIN",
                    CodecLevel: "AUTO",
                    GopSize: 48,
                    GopSizeUnits: "FRAMES",
                    GopClosedCadence: 1,
                    NumberBFramesBetweenReferenceFrames: 3,
                    SceneChangeDetect: "TRANSITION_DETECTION",
                  },
                },
              },
              AudioDescriptions: [
                {
                  CodecSettings: {
                    Codec: "AAC",
                    AacSettings: { Bitrate: 128000, CodingMode: "CODING_MODE_2_0", SampleRate: 48000 },
                  },
                },
              ],
              ContainerSettings: { Container: "M3U8" },
            },
          ],
        },
      ],
    } as any;

    const params: any = {
      Role: MEDIACONVERT_ROLE_ARN,
      Settings: jobSettings,
      AccelerationSettings: { Mode: "PREFERRED" },
      StatusUpdateInterval: "SECONDS_60",
    };
    if (MEDIACONVERT_QUEUE_ARN) params.Queue = MEDIACONVERT_QUEUE_ARN;

    let out;
    try {
      out = await mc.send(new CreateJobCommand(params));
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e?.name === "SubscriptionRequiredException") {
        return new Response(
          JSON.stringify({
            error: "MediaConvert not activated in this account/region",
            hint: "Open AWS Console → MediaConvert (same region) → Get started/Activate, then retry.",
          }),
          { status: 400 }
        );
      }
      // 若因 TrickPlay 校验失败，则回退为不生成 TrickPlay 再试一次，保证主转码成功
      const msg = String(e?.message || "");
      if (e?.name === "BadRequestException" && (msg.includes("imageBasedTrickPlaySettings") || msg.includes("ImageBasedTrickPlay"))) {
        try {
          const settings: any = params.Settings;
          if (settings?.OutputGroups?.[0]?.OutputGroupSettings?.HlsGroupSettings) {
            settings.OutputGroups[0].OutputGroupSettings.HlsGroupSettings.ImageBasedTrickPlay = "NONE";
            delete settings.OutputGroups[0].OutputGroupSettings.HlsGroupSettings.ImageBasedTrickPlaySettings;
          }
          out = await mc.send(new CreateJobCommand(params));
        } catch (e2) {
          throw e2;
        }
      } else {
        throw err;
      }
    }
    const jobArn = out?.Job?.Arn || null;

    return Response.json({ ok: true, jobArn, hlsPrefix: `outputs/hls/${base}-${jobId}/` });
  } catch (error: unknown) {
    console.error("[mediaconvert/start] error", error);
    const msg = error instanceof Error ? error.message : "start mediaconvert failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}



