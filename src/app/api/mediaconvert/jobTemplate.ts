export function buildHlsJobSettings(params: {
  destinationS3: string; // s3://bucket/outputs/hls/{base}-{jobId}/
}): any {
  const { destinationS3 } = params;
  return {
    TimecodeConfig: { Source: "ZEROBASED" },
    OutputGroups: [
      {
        Name: "HLS",
        OutputGroupSettings: {
          Type: "HLS_GROUP_SETTINGS",
          HlsGroupSettings: {
            Destination: destinationS3,
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
              ThumbnailWidth: 240,
              ThumbnailHeight: 144,
              TileWidth: 10,
              TileHeight: 10,
            },
          },
        },
        // 低码率优先（360p → 480p → 720p → 1080p）
        Outputs: [
          {
            NameModifier: "_360p",
            VideoDescription: {
              Width: 640,
              Height: 360,
              CodecSettings: {
                Codec: "H_264",
                H264Settings: {
                  RateControlMode: "QVBR",
                  QvbrQualityLevel: 7,
                  MaxBitrate: 1_000_000,
                  GopSize: 48,
                  GopSizeUnits: "FRAMES",
                  GopClosedCadence: 1,
                  NumberBFramesBetweenReferenceFrames: 3,
                  SceneChangeDetect: "TRANSITION_DETECTION",
                },
              },
            },
            AudioDescriptions: [
              { CodecSettings: { Codec: "AAC", AacSettings: { Bitrate: 128000, CodingMode: "CODING_MODE_2_0", SampleRate: 48000 } } },
            ],
            ContainerSettings: { Container: "M3U8" },
          },
          {
            NameModifier: "_480p",
            VideoDescription: {
              Width: 854,
              Height: 480,
              CodecSettings: {
                Codec: "H_264",
                H264Settings: {
                  RateControlMode: "QVBR",
                  QvbrQualityLevel: 7,
                  MaxBitrate: 2_000_000,
                  GopSize: 48,
                  GopSizeUnits: "FRAMES",
                  GopClosedCadence: 1,
                  NumberBFramesBetweenReferenceFrames: 3,
                  SceneChangeDetect: "TRANSITION_DETECTION",
                },
              },
            },
            AudioDescriptions: [
              { CodecSettings: { Codec: "AAC", AacSettings: { Bitrate: 128000, CodingMode: "CODING_MODE_2_0", SampleRate: 48000 } } },
            ],
            ContainerSettings: { Container: "M3U8" },
          },
          {
            NameModifier: "_720p",
            VideoDescription: {
              Width: 1280,
              Height: 720,
              CodecSettings: {
                Codec: "H_264",
                H264Settings: {
                  RateControlMode: "QVBR",
                  QvbrQualityLevel: 7,
                  MaxBitrate: 4_500_000,
                  GopSize: 48,
                  GopSizeUnits: "FRAMES",
                  GopClosedCadence: 1,
                  NumberBFramesBetweenReferenceFrames: 3,
                  SceneChangeDetect: "TRANSITION_DETECTION",
                },
              },
            },
            AudioDescriptions: [
              { CodecSettings: { Codec: "AAC", AacSettings: { Bitrate: 128000, CodingMode: "CODING_MODE_2_0", SampleRate: 48000 } } },
            ],
            ContainerSettings: { Container: "M3U8" },
          },
          {
            NameModifier: "_1080p",
            VideoDescription: {
              Width: 1920,
              Height: 1080,
              CodecSettings: {
                Codec: "H_264",
                H264Settings: {
                  RateControlMode: "QVBR",
                  QvbrQualityLevel: 7,
                  MaxBitrate: 8000000,
                  GopSize: 48,
                  GopSizeUnits: "FRAMES",
                  GopClosedCadence: 1,
                  NumberBFramesBetweenReferenceFrames: 3,
                  SceneChangeDetect: "TRANSITION_DETECTION",
                },
              },
            },
            AudioDescriptions: [
              { CodecSettings: { Codec: "AAC", AacSettings: { Bitrate: 128000, CodingMode: "CODING_MODE_2_0", SampleRate: 48000 } } },
            ],
            ContainerSettings: { Container: "M3U8" },
          },
        ],
      },
    ],
  };
}

// CMAF HLS（低延迟/更兼容），支持 1080p 与 4K（2160p）分档；全部采用 QVBR
export function buildCmafHlsJobSettings(params: {
  destinationS3: string; // s3://bucket/outputs/cmaf/{base}-{jobId}/
  enable4k?: boolean; // 默认 true
  qvbrQuality?: number; // 1-10，默认 7
}): any {
  const { destinationS3, enable4k = true, qvbrQuality = 7 } = params;
  const outputs: any[] = [
    {
      NameModifier: "_360p",
      VideoDescription: {
        Width: 640,
        Height: 360,
        CodecSettings: {
          Codec: "H_264",
          H264Settings: {
            RateControlMode: "QVBR",
            QvbrQualityLevel: qvbrQuality,
            MaxBitrate: 1000000,
            GopSize: 48,
            GopSizeUnits: "FRAMES",
            GopClosedCadence: 1,
            NumberBFramesBetweenReferenceFrames: 3,
            SceneChangeDetect: "TRANSITION_DETECTION",
          },
        },
      },
      ContainerSettings: { Container: "CMFC", CmfcSettings: {} },
    },
    {
      NameModifier: "_720p",
      VideoDescription: {
        Width: 1280,
        Height: 720,
        CodecSettings: {
          Codec: "H_264",
          H264Settings: {
            RateControlMode: "QVBR",
            QvbrQualityLevel: qvbrQuality,
            MaxBitrate: 4500000,
            GopSize: 48,
            GopSizeUnits: "FRAMES",
            GopClosedCadence: 1,
            NumberBFramesBetweenReferenceFrames: 3,
            SceneChangeDetect: "TRANSITION_DETECTION",
          },
        },
      },
      ContainerSettings: { Container: "CMFC", CmfcSettings: {} },
    },
    {
      NameModifier: "_1080p",
      VideoDescription: {
        Width: 1920,
        Height: 1080,
        CodecSettings: {
          Codec: "H_264",
          H264Settings: {
            RateControlMode: "QVBR",
            QvbrQualityLevel: qvbrQuality,
            MaxBitrate: 8000000,
            GopSize: 48,
            GopSizeUnits: "FRAMES",
            GopClosedCadence: 1,
            NumberBFramesBetweenReferenceFrames: 3,
            SceneChangeDetect: "TRANSITION_DETECTION",
          },
        },
      },
      ContainerSettings: { Container: "CMFC", CmfcSettings: {} },
    },
  ];

  if (enable4k) {
    outputs.push({
      NameModifier: "_2160p",
      VideoDescription: {
        Width: 3840,
        Height: 2160,
        CodecSettings: {
          // 使用 H.265 可显著降低 4K 码率；若账户未启用 HEVC，可改回 H_264
          Codec: "H_265",
          H265Settings: {
            RateControlMode: "QVBR",
            QvbrQualityLevel: Math.min(10, Math.max(1, qvbrQuality + 1)),
            MaxBitrate: 22000000,
            GopSize: 48,
            GopSizeUnits: "FRAMES",
            GopClosedCadence: 1,
            NumberBFramesBetweenReferenceFrames: 3,
            SceneChangeDetect: "TRANSITION_DETECTION",
          },
        },
      },
      ContainerSettings: { Container: "CMFC", CmfcSettings: {} },
    });
  }

  return {
    TimecodeConfig: { Source: "ZEROBASED" },
    OutputGroups: [
      {
        Name: "CMAF",
        OutputGroupSettings: {
          Type: "CMAF_GROUP_SETTINGS",
          CmafGroupSettings: {
            Destination: destinationS3,
            SegmentLength: 4,
            MinSegmentLength: 0,
            ManifestCompression: "NONE",
            ManifestDurationFormat: "INTEGER",
            ClientCache: "ENABLED",
            StreamInfResolution: "INCLUDE",
            WriteDashManifest: "DISABLED",
            WriteHlsManifest: "ENABLED",
            CodecSpecification: "RFC_4281",
            // 低延迟 HLS 参数
            HlsManifests: [{ ManifestNameModifier: "", ManifestName: "index" }],
            // CMAF 要求每个视频输出配一个音频（或使用独立音频输出），这里简化为独立 AAC 音频轨
            DestinationSettings: {},
          },
        },
        Outputs: [
          // 视频 outputs
          ...outputs,
          // 独立音频输出（AAC）
          {
            NameModifier: "_audio",
            AudioDescriptions: [
              { CodecSettings: { Codec: "AAC", AacSettings: { Bitrate: 128000, CodingMode: "CODING_MODE_2_0", SampleRate: 48000 } } },
            ],
            ContainerSettings: { Container: "CMFC", CmfcSettings: {} },
          },
        ],
      },
    ],
  };
}



