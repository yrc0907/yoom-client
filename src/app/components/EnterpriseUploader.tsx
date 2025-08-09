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
      // 若是被中止，直接抛出
      const err = e as { name?: string };
      if (err?.name === "AbortError") throw e;
      await new Promise(r => setTimeout(r, base * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

function getFingerprint(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export default function EnterpriseUploader({ accept = "video/*", partSizeBytes = 8 * 1024 * 1024, concurrency = 4, onCompleted }: EnterpriseUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeed] = useState<string>("0 MB/s");
  const [eta, setEta] = useState<string>("--");

  const controllerRef = useRef<AbortController | null>(null);
  const currentUploadRef = useRef<{ key: string; uploadId: string; chunkSize: number; file?: File } | null>(null);
  const pendingPartsRef = useRef<Set<number>>(new Set());
  const uploadedBytesRef = useRef<number>(0);
  const totalBytesRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const lastBytesRef = useRef<number>(0);

  const pick = useCallback(() => inputRef.current?.click(), []);

  async function listUploadedParts(key: string, uploadId: string): Promise<{ partNumbers: Set<number>; uploadedBytes: number }> {
    const res = await fetch("/api/s3/multipart/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, uploadId }) });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json() as { parts: { PartNumber: number; ETag: string; Size?: number }[] };
    const setNums = new Set<number>();
    let uploadedBytes = 0;
    for (const p of data.parts) { setNums.add(p.PartNumber); uploadedBytes += p.Size || 0; }
    return { partNumbers: setNums, uploadedBytes };
  }

  async function startOrResumeUpload(file: File) {
    setError(null);
    setProgress(0);
    setStatus("准备上传...");

    setUploading(true);
    setPaused(false);

    const fingerprint = getFingerprint(file);
    const saved = localStorage.getItem(`uploader:session:${fingerprint}`);

    let key: string;
    let uploadId: string;
    let chunkSize = partSizeBytes;

    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { key: string; uploadId: string; chunkSize: number };
        key = parsed.key; uploadId = parsed.uploadId; chunkSize = parsed.chunkSize || partSizeBytes;
      } catch { localStorage.removeItem(`uploader:session:${fingerprint}`); }
    }

    if (!saved) {
      const initRes = await fetch("/api/s3/multipart/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileType: file.type }),
      });
      if (!initRes.ok) throw new Error(await initRes.text());
      const init = await initRes.json() as { key: string; uploadId: string; partSize: number };
      key = init.key; uploadId = init.uploadId; chunkSize = init.partSize || partSizeBytes;
      localStorage.setItem(`uploader:session:${fingerprint}`, JSON.stringify({ key, uploadId, chunkSize }));
    }

    currentUploadRef.current = { key: key!, uploadId: uploadId!, chunkSize, file };

    const totalParts = Math.ceil(file.size / chunkSize);
    totalBytesRef.current = file.size;

    // 获取已上传分片
    const listed = await listUploadedParts(key!, uploadId!);
    pendingPartsRef.current = new Set(Array.from({ length: totalParts }, (_, i) => i + 1).filter(n => !listed.partNumbers.has(n)));
    uploadedBytesRef.current = listed.uploadedBytes;
    setProgress(Math.round((uploadedBytesRef.current / file.size) * 100));

    await runUploadLoop();
  }

  async function runUploadLoop() {
    const info = currentUploadRef.current;
    if (!info || !info.file) return;
    const { key, uploadId, chunkSize, file } = info;

    setStatus("上传中...");
    setError(null);

    const controller = new AbortController();
    controllerRef.current = controller;

    // 速度统计
    lastTickRef.current = performance.now();
    lastBytesRef.current = uploadedBytesRef.current;

    async function uploadPart(partNumber: number) {
      const start = (partNumber - 1) * chunkSize;
      const end = Math.min(file.size, partNumber * chunkSize);
      const blob = file.slice(start, end);

      // 签名请求不携带 signal，避免被误中止
      const signRes = await fetch("/api/s3/multipart/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, uploadId, partNumber }),
      });
      if (!signRes.ok) throw new Error(await signRes.text());
      const { url } = await signRes.json() as { url: string };

      const etag = await retry(async () => {
        const res = await fetch(url, { method: "PUT", body: blob, signal: controller.signal });
        if (!res.ok) throw new Error(`上传分片失败 ${partNumber}: ${res.status}`);
        const etagHeader = res.headers.get("ETag") || res.headers.get("etag");
        if (!etagHeader) throw new Error("缺少ETag响应头");
        return etagHeader.replaceAll('"', '');
      });

      // 成功后再移除该分片
      pendingPartsRef.current.delete(partNumber);
      uploadedBytesRef.current += blob.size;

      const now = performance.now();
      const dt = (now - lastTickRef.current) / 1000; // 秒
      if (dt >= 0.5) {
        const dBytes = uploadedBytesRef.current - lastBytesRef.current;
        const mbps = dBytes / dt / (1024 * 1024);
        setSpeed(`${mbps.toFixed(2)} MB/s`);
        const remaining = totalBytesRef.current - uploadedBytesRef.current;
        const secLeft = Math.max(0, remaining / (dBytes / dt || 1));
        const m = Math.floor(secLeft / 60), s = Math.floor(secLeft % 60);
        setEta(`${m}:${String(s).padStart(2, '0')}`);
        lastTickRef.current = now;
        lastBytesRef.current = uploadedBytesRef.current;
      }

      setProgress(Math.round((uploadedBytesRef.current / totalBytesRef.current) * 100));
    }

    let active = 0;
    const trySpawn = () => {
      if (paused) return;
      while (active < concurrency && pendingPartsRef.current.size > 0) {
        const it = pendingPartsRef.current.values().next();
        const partNumber = it.value as number;
        active++;
        uploadPart(partNumber).then(() => {
          active--; trySpawn();
        }).catch((err) => {
          active--;
          // 中止：不报错，保留该分片在队列中以便继续
          const e2 = err as { name?: string };
          if (e2?.name === "AbortError" || controller.signal.aborted) {
            // do nothing
          } else {
            // 非中止错误：把分片放回队列，显示错误（将被下一轮重传）
            pendingPartsRef.current.add(partNumber);
            setError(err instanceof Error ? err.message : String(err));
          }
        });
        // 若当前分片仍在队列，避免被并发重复启动
        pendingPartsRef.current.delete(partNumber);
      }
      if (active === 0 && pendingPartsRef.current.size === 0) {
        void completeUpload();
      }
    };

    trySpawn();
  }

  async function completeUpload() {
    const info = currentUploadRef.current;
    if (!info) return;
    setStatus("合并分片...");

    // 需列出所有已上传分片并排序
    const listed = await listUploadedParts(info.key, info.uploadId);
    const parts = Array.from(listed.partNumbers).sort((a, b) => a - b).map(n => ({ PartNumber: n }));
    // AWS 需要 ETag，但我们没有缓存 ETag；简化起见，重新列出包含 ETag 的结构
    const res = await fetch("/api/s3/multipart/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: info.key, uploadId: info.uploadId }) });
    const data = await res.json() as { parts: { PartNumber: number; ETag: string }[] };
    const completeRes = await fetch("/api/s3/multipart/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: info.key, uploadId: info.uploadId, parts: data.parts.map(p => ({ ETag: p.ETag, PartNumber: p.PartNumber })) }),
    });
    if (!completeRes.ok) throw new Error(await completeRes.text());

    setStatus("完成");
    setUploading(false);
    controllerRef.current = null;

    // 清理 session
    const file = info.file!;
    localStorage.removeItem(`uploader:session:${getFingerprint(file)}`);

    try { await fetch("/api/s3/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: info.key }) }); } catch { }

    onCompleted?.({ key: info.key });
  }

  const onInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void startOrResumeUpload(file);
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void startOrResumeUpload(file);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => e.preventDefault(), []);

  const onPause = useCallback(() => {
    setPaused(true);
    controllerRef.current?.abort();
    setStatus("已暂停");
  }, []);

  const onResume = useCallback(() => {
    if (!currentUploadRef.current?.file) return;
    setPaused(false);
    void runUploadLoop();
  }, []);

  const onCancel = useCallback(async () => {
    controllerRef.current?.abort();
    setUploading(false);
    setStatus("已取消");
    const info = currentUploadRef.current;
    if (info) {
      try { await fetch("/api/s3/multipart/abort", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: info.key, uploadId: info.uploadId }) }); } catch { }
      if (info.file) localStorage.removeItem(`uploader:session:${getFingerprint(info.file)}`);
    }
    controllerRef.current = null;
  }, []);

  return (
    <div style={{ border: "1px dashed #cbd5e1", padding: 16, borderRadius: 12, background: "#fafafa" }} onDrop={onDrop} onDragOver={onDragOver}>
      <label htmlFor="enterprise-video-input" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}>选择视频</label>
      <input id="enterprise-video-input" ref={inputRef} type="file" accept={accept} style={{ display: "none" }} onChange={onInput} title="选择视频文件" />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 600 }}>企业级视频上传</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>支持多分片/并发/断点续传/拖拽/取消</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!uploading && <button onClick={() => inputRef.current?.click()} style={{ background: "#111827", color: "white", padding: "8px 12px", borderRadius: 8 }}>选择文件</button>}
          {uploading && !paused && <button onClick={onPause} style={{ background: "#f3f4f6", color: "#111827", padding: "8px 12px", borderRadius: 8 }}>暂停</button>}
          {uploading && paused && <button onClick={onResume} style={{ background: "#10b981", color: "white", padding: "8px 12px", borderRadius: 8 }}>继续</button>}
          {uploading && <button onClick={onCancel} style={{ background: "#fee2e2", color: "#991b1b", padding: "8px 12px", borderRadius: 8 }}>取消</button>}
        </div>
      </div>

      <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "white", border: "1px solid #e5e7eb" }}>
        <div style={{ height: 10, background: "#e5e7eb", borderRadius: 6 }}>
          <div style={{ width: `${progress}%`, height: 10, background: "#22c55e", borderRadius: 6, transition: "width .2s ease" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: "#6b7280" }}>
          <span>进度：{progress}%（{speed}，剩余 {eta}）</span>
          <span>{status}</span>
        </div>
        {error && <div style={{ marginTop: 8, color: "#b91c1c" }}>{error}</div>}
      </div>
    </div>
  );
} 