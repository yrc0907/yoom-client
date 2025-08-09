"use client";

import { useCallback, useMemo, useRef, useState } from "react";

export type EnterpriseUploaderProps = {
  accept?: string;
  partSizeBytes?: number; // 默认 8MB
  concurrency?: number; // 默认 4
  onCompleted?: (payload: { key: string }) => void;
};

// 简单指数退避
async function retry<T>(fn: () => Promise<T>, retries = 5, base = 500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, base * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

export default function EnterpriseUploader({ accept = "video/*", partSizeBytes = 8 * 1024 * 1024, concurrency = 4, onCompleted }: EnterpriseUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const currentUploadRef = useRef<{ key: string; uploadId: string } | null>(null);

  const pick = useCallback(() => inputRef.current?.click(), []);

  const handleFiles = useCallback(async (file: File) => {
    setError(null);
    setProgress(0);
    setStatus("准备上传...");

    try {
      setUploading(true);
      // 1) 初始化多分片
      const initRes = await fetch("/api/s3/multipart/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileType: file.type }),
      });
      if (!initRes.ok) throw new Error(await initRes.text());
      const { key, uploadId, partSize } = await initRes.json() as { key: string; uploadId: string; partSize: number };
      currentUploadRef.current = { key, uploadId };
      const chunkSize = partSize || partSizeBytes;

      const totalParts = Math.ceil(file.size / chunkSize);
      const uploadedParts: { ETag: string; PartNumber: number }[] = [];
      let uploadedBytes = 0;

      // 2) 构建任务队列
      const tasks = Array.from({ length: totalParts }, (_, i) => i + 1);
      const controller = new AbortController();
      controllerRef.current = controller;

      async function uploadPart(partNumber: number) {
        const start = (partNumber - 1) * chunkSize;
        const end = Math.min(file.size, partNumber * chunkSize);
        const blob = file.slice(start, end);

        // 2.1) 请求签名 url
        const signRes = await fetch("/api/s3/multipart/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, uploadId, partNumber }),
          signal: controller.signal,
        });
        if (!signRes.ok) throw new Error(await signRes.text());
        const { url } = await signRes.json() as { url: string };

        // 2.2) 以 PUT 上传该分片
        const etag = await retry(async () => {
          const res = await fetch(url, { method: "PUT", body: blob, signal: controller.signal });
          if (!res.ok) throw new Error(`上传分片失败 ${partNumber}: ${res.status}`);
          const etagHeader = res.headers.get("ETag") || res.headers.get("etag");
          if (!etagHeader) throw new Error("缺少ETag响应头");
          return etagHeader.replaceAll('"', '');
        });

        uploadedParts.push({ ETag: etag, PartNumber: partNumber });
        uploadedBytes += blob.size;
        setProgress(Math.round((uploadedBytes / file.size) * 100));
      }

      setStatus("上传中...");

      // 3) 并发执行
      let active = 0;
      let idx = 0;
      await new Promise<void>((resolve, reject) => {
        const next = () => {
          if (idx >= tasks.length && active === 0) return resolve();
          while (active < concurrency && idx < tasks.length) {
            const n = tasks[idx++];
            active++;
            uploadPart(n).then(() => {
              active--; next();
            }).catch(reject);
          }
        };
        next();
      });

      // 4) 完成上传
      setStatus("合并分片...");
      uploadedParts.sort((a, b) => a.PartNumber - b.PartNumber);
      const completeRes = await fetch("/api/s3/multipart/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, uploadId, parts: uploadedParts }),
      });
      if (!completeRes.ok) throw new Error(await completeRes.text());

      setStatus("完成");
      setUploading(false);
      controllerRef.current = null;

      try { await fetch("/api/s3/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) }); } catch { }

      onCompleted?.({ key });
    } catch (e: unknown) {
      const err = e as { name?: string };
      if (err?.name === "AbortError") {
        setStatus("已取消");
      } else {
        const msg = e instanceof Error ? e.message : "上传失败";
        setError(msg);
      }
      setUploading(false);
      // 中止并通知服务端 abort
      const current = currentUploadRef.current;
      if (current) {
        try {
          await fetch("/api/s3/multipart/abort", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(current) });
        } catch { }
      }
      controllerRef.current = null;
    }
  }, [concurrency, onCompleted, partSizeBytes]);

  const onInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFiles(file);
  }, [handleFiles]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFiles(file);
  }, [handleFiles]);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => e.preventDefault(), []);

  const onCancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  return (
    <div style={{ border: "1px dashed #cbd5e1", padding: 16, borderRadius: 12, background: "#fafafa" }} onDrop={onDrop} onDragOver={onDragOver}>
      <label htmlFor="enterprise-video-input" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}>选择视频</label>
      <input id="enterprise-video-input" ref={inputRef} type="file" accept={accept} style={{ display: "none" }} onChange={onInput} title="选择视频文件" />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 600 }}>企业级视频上传</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>支持多分片/并发/断网重试，拖拽或点击选择</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => inputRef.current?.click()} disabled={uploading} style={{ background: "#111827", color: "white", padding: "8px 12px", borderRadius: 8 }}>
            {uploading ? "上传中..." : "选择文件"}
          </button>
          {uploading && (
            <button onClick={onCancel} style={{ background: "#f3f4f6", color: "#111827", padding: "8px 12px", borderRadius: 8 }}>
              取消
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "white", border: "1px solid #e5e7eb" }}>
        <div style={{ height: 10, background: "#e5e7eb", borderRadius: 6 }}>
          <div style={{ width: `${progress}%`, height: 10, background: "#22c55e", borderRadius: 6, transition: "width .2s ease" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: "#6b7280" }}>
          <span>进度：{progress}%</span>
          <span>{status}</span>
        </div>
        {error && <div style={{ marginTop: 8, color: "#b91c1c" }}>{error}</div>}
      </div>
    </div>
  );
} 