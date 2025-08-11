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
        // 低码率优先（360p → 480p → 720p）
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
                  QvbrQuality: 7,
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
                  QvbrQuality: 7,
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
                  QvbrQuality: 7,
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
        ],
      },
    ],
  };
}


