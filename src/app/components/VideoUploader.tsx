"use client";

import { useCallback, useMemo, useRef, useState } from "react";

type PresignResponse = {
  url: string;
  fields: Record<string, string>;
  key: string;
  maxBytes: number;
};

export default function VideoUploader() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadedKey, setUploadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accept = useMemo(() => "video/*", []);

  const onPick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setProgress(0);
    setUploadedKey(null);

    try {
      setUploading(true);
      // 1) 请求预签名
      const presignRes = await fetch("/api/s3/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
        }),
      });

      if (!presignRes.ok) {
        const msg = await presignRes.text();
        throw new Error(msg || "presign failed");
      }

      const { url, fields, key } = (await presignRes.json()) as PresignResponse;

      // 2) 构造 FormData 上传到 S3
      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append("file", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const percent = Math.round((evt.loaded / evt.total) * 100);
          setProgress(percent);
        }
      };
      const done = new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`S3 upload failed: ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
      });

      xhr.send(formData);
      await done;

      setUploadedKey(key);

      // 3) 注册到本地索引，便于在网络受限时也能列举
      try {
        await fetch("/api/s3/videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
      } catch { }

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "上传失败";
      setError(message);
    } finally {
      setUploading(false);
    }
  }, []);

  return (
    <div style={{ border: "1px solid #e5e7eb", padding: 16, borderRadius: 8 }}>
      <label htmlFor="video-file-input" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}>
        选择视频文件
      </label>
      <input
        id="video-file-input"
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={onFileChange}
        aria-label="选择视频文件"
        title="选择视频文件"
      />

      <button
        onClick={onPick}
        disabled={uploading}
        style={{
          background: "#111827",
          color: "white",
          padding: "8px 12px",
          borderRadius: 6,
          cursor: uploading ? "not-allowed" : "pointer",
        }}
      >
        {uploading ? "上传中..." : "选择视频并上传"}
      </button>

      {uploading && (
        <div style={{ marginTop: 8 }}>
          进度：{progress}%
          <div style={{ height: 6, background: "#e5e7eb", borderRadius: 4 }}>
            <div
              style={{
                width: `${progress}%`,
                height: 6,
                background: "#2563eb",
                borderRadius: 4,
                transition: "width .2s ease",
              }}
            />
          </div>
        </div>
      )}

      {uploadedKey && (
        <div style={{ marginTop: 8, color: "#065f46" }}>
          上传成功，S3 Key: {uploadedKey}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, color: "#991b1b" }}>
          {error}
        </div>
      )}
    </div>
  );
} 