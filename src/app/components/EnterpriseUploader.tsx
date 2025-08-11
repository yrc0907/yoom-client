"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "./ToastCenter";

export type EnterpriseUploaderProps = {
  accept?: string;
  partSizeBytes?: number; // 默认 8MB
  concurrency?: number; // 默认 4
  onCompleted?: (payload: { key: string }) => void;
};

function getDefaultConcurrency(): number {
  const nav = (typeof navigator !== "undefined" ? navigator : undefined) as (Navigator & { hardwareConcurrency?: number }) | undefined;
  const hc = typeof nav?.hardwareConcurrency === "number" ? nav.hardwareConcurrency : undefined;
  return Math.min(6, Math.max(3, hc ? Math.ceil(hc / 2) : 4));
}

function getEffectiveConnectionType(): string | undefined {
  const nav = (typeof navigator !== "undefined" ? navigator : undefined) as (Navigator & { connection?: { effectiveType?: string } }) | undefined;
  return nav?.connection?.effectiveType;
}

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

function getLegacyFingerprint(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

async function computeResumeKey(file: File): Promise<string> {
  // sha256(head 256KB + size + tail 256KB)
  const HEAD_BYTES = 256 * 1024;
  const TAIL_BYTES = 256 * 1024;
  const head = file.slice(0, Math.min(HEAD_BYTES, file.size));
  const tailStart = file.size > TAIL_BYTES ? file.size - TAIL_BYTES : 0;
  const tail = file.slice(tailStart, file.size);
  const headBuf = await head.arrayBuffer();
  const tailBuf = await tail.arrayBuffer();
  const sizeBuf = new ArrayBuffer(8);
  new DataView(sizeBuf).setBigUint64(0, BigInt(file.size));
  const concat = new Uint8Array(headBuf.byteLength + 8 + tailBuf.byteLength);
  concat.set(new Uint8Array(headBuf), 0);
  concat.set(new Uint8Array(sizeBuf), headBuf.byteLength);
  concat.set(new Uint8Array(tailBuf), headBuf.byteLength + 8);
  const digest = await crypto.subtle.digest("SHA-256", concat);
  const hashArray = Array.from(new Uint8Array(digest));
  const hex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

// 生成封面帧（JPG）
async function generatePosterFromFile(file: File, atSeconds = 1.5): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.src = url;
    video.crossOrigin = "anonymous";
    video.preload = "metadata";
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("metadata load failed"));
    });
    video.currentTime = Math.min(atSeconds, Math.max(0, (video.duration || atSeconds) - 0.1));
    await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
    const canvas = document.createElement("canvas");
    const w = Math.min(640, video.videoWidth || 640);
    const h = Math.round(w * (video.videoHeight || 360) / (video.videoWidth || 640));
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas context missing");
    ctx.drawImage(video, 0, 0, w, h);
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => b ? res(b) : rej(new Error("toBlob failed")), "image/jpeg", 0.85));
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 通过预签名直传封面
async function uploadPosterBlob(baseName: string, blob: Blob): Promise<string> {
  const presign = await fetch("/api/s3/presign-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: `${baseName}.jpg`, fileType: "image/jpeg", fileSize: blob.size, baseName }),
  });
  if (!presign.ok) throw new Error(await presign.text());
  const { url, fields, key } = await presign.json() as { url: string; fields: Record<string, string>; key: string };
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  fd.append("file", blob, `${baseName}.jpg`);
  const res = await fetch(url, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`upload poster failed: ${res.status}`);
  return key;
}

export default function EnterpriseUploader({ accept = "video/*", partSizeBytes = 8 * 1024 * 1024, concurrency = getDefaultConcurrency(), onCompleted }: EnterpriseUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { show } = useToast();

  const [uploading, setUploading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeed] = useState<string>("0 MB/s");
  const [eta, setEta] = useState<string>("--");

  const [curConcurrency, setCurConcurrency] = useState<number>(concurrency);
  const [networkStatus, setNetworkStatus] = useState<string>("--");
  const [totalRetries, setTotalRetries] = useState<number>(0);

  // 自适应并发/弱网检测指标
  const metricsRef = useRef<{
    rttsMs: number[];
    successes: number;
    failures: number;
    lastAdjustAt: number;
    adjustTimer: number | null;
  }>({ rttsMs: [], successes: 0, failures: 0, lastAdjustAt: 0, adjustTimer: null });

  type QueueItem = { file: File; name: string; size: number; status: "pending" | "uploading" | "paused" | "done" | "error"; progress: number; key?: string; message?: string };
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const currentUploadRef = useRef<{ key: string; uploadId: string; chunkSize: number; file?: File } | null>(null);
  const pendingPartsRef = useRef<Set<number>>(new Set());
  const uploadedBytesRef = useRef<number>(0);
  const totalBytesRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const lastBytesRef = useRef<number>(0);
  const smoothedMbpsRef = useRef<number>(0);

  // CRC32C Web Worker
  const crcWorkerRef = useRef<Worker | null>(null);
  const nextWorkerMessageIdRef = useRef<number>(1);
  const workerPromisesRef = useRef<Map<number, { resolve: (v: string) => void; reject: (e: unknown) => void }>>(new Map());

  useEffect(() => {
    // Lazily initialize the worker on first mount
    if (typeof window !== "undefined" && !crcWorkerRef.current) {
      try {
        const worker = new Worker(new URL("../../workers/crc32c.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (ev: MessageEvent) => {
          const { id, base64 } = ev.data as { id: number; base64: string };
          const entry = workerPromisesRef.current.get(id);
          if (entry) {
            workerPromisesRef.current.delete(id);
            entry.resolve(base64);
          }
        };
        worker.onerror = (ev) => {
          // Reject all pending requests on worker error
          const err = new Error(`CRC32C worker error: ${ev.message}`);
          for (const [, entry] of workerPromisesRef.current) entry.reject(err);
          workerPromisesRef.current.clear();
        };
        crcWorkerRef.current = worker;
      } catch {
        crcWorkerRef.current = null;
      }
    }
    return () => {
      if (crcWorkerRef.current) {
        crcWorkerRef.current.terminate();
        crcWorkerRef.current = null;
      }
      workerPromisesRef.current.clear();
    };
  }, []);

  // pick 函数无需导出，使用处已内联调用 inputRef

  async function listUploadedParts(key: string, uploadId: string): Promise<{ partNumbers: Set<number>; uploadedBytes: number }> {
    const res = await fetch("/api/s3/multipart/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, uploadId }) });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json() as { parts: { PartNumber: number; ETag: string; Size?: number }[] };
    const setNums = new Set<number>();
    let uploadedBytes = 0;
    for (const p of data.parts) { setNums.add(p.PartNumber); uploadedBytes += p.Size || 0; }
    return { partNumbers: setNums, uploadedBytes };
  }

  function enqueueFiles(files: File[]) {
    if (files.length === 0) return;
    setQueue((prev) => [...prev, ...files.map<QueueItem>(f => ({ file: f, name: f.name, size: f.size, status: "pending" as const, progress: 0 }))]);
    // 若当前无任务在跑，启动
    setTimeout(() => {
      if (activeIdx === null) processNext();
    }, 0);
  }

  function processNext() {
    setError(null);
    setStatus(null);
    setSpeed("0 MB/s");
    setEta("--");
    setProgress(0);

    setQueue((prev) => {
      const idx = prev.findIndex(it => it.status === "pending");
      if (idx === -1) { setActiveIdx(null); setUploading(false); setStatus(null); return prev; }
      setActiveIdx(idx);
      const next = [...prev];
      next[idx] = { ...next[idx], status: "uploading", progress: 0 };
      setUploading(true);
      void startOrResumeUpload(next[idx].file);
      return next;
    });
  }

  async function startOrResumeUpload(file: File) {
    setError(null);
    setProgress(0);
    setStatus("准备上传...");

    setPaused(false);

    const legacyKey = getLegacyFingerprint(file);
    const resumeKey = await computeResumeKey(file);
    const saved = localStorage.getItem(`uploader:session:${resumeKey}`) || localStorage.getItem(`uploader:session:${legacyKey}`);

    let key: string;
    let uploadId: string;
    let chunkSize = partSizeBytes;

    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { key: string; uploadId: string; chunkSize: number };
        key = parsed.key; uploadId = parsed.uploadId; chunkSize = parsed.chunkSize || partSizeBytes;
      } catch { localStorage.removeItem(`uploader:session:${resumeKey}`); localStorage.removeItem(`uploader:session:${legacyKey}`); }
    }

    if (!saved) {
      const initRes = await fetch("/api/s3/multipart/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size }),
      });
      if (!initRes.ok) throw new Error(await initRes.text());
      const init = await initRes.json() as { key: string; uploadId: string; partSize: number };
      key = init.key; uploadId = init.uploadId; chunkSize = init.partSize || partSizeBytes;
      // 弱网优先更小分片，强网可保持/略增（S3 最小 5MB）
      try {
        const et = getEffectiveConnectionType();
        const ONE_MB = 1024 * 1024;
        const minChunk = 5 * ONE_MB;
        if (et && ["2g", "slow-2g", "3g"].includes(et)) {
          chunkSize = Math.max(minChunk, 5 * ONE_MB);
        } else if (et && ["4g", "wifi"].includes(et)) {
          chunkSize = Math.max(minChunk, init.partSize || 8 * ONE_MB);
        }
      } catch { }
      localStorage.setItem(`uploader:session:${resumeKey}`, JSON.stringify({ key, uploadId, chunkSize }));
    }

    currentUploadRef.current = { key: key!, uploadId: uploadId!, chunkSize, file };

    const totalParts = Math.ceil(file.size / chunkSize);
    totalBytesRef.current = file.size;

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

    lastTickRef.current = performance.now();
    lastBytesRef.current = uploadedBytesRef.current;

    // 计算 crc32c（在 Web Worker 中执行，输出 base64）
    async function crc32cBase64(blob: Blob): Promise<string> {
      const worker = crcWorkerRef.current;
      const buffer = await blob.arrayBuffer();
      // 无可用 worker 时，简单回退：不带校验（不发送校验头）
      if (!worker) {
        return "";
      }
      const id = nextWorkerMessageIdRef.current++;
      return new Promise<string>((resolve, reject) => {
        workerPromisesRef.current.set(id, { resolve, reject });
        try {
          // Transfer the buffer to avoid copy
          worker.postMessage({ id, buffer }, [buffer]);
        } catch (e) {
          workerPromisesRef.current.delete(id);
          reject(e);
        }
      });
    }

    // 预留 MD5 实现（当前不启用）

    async function uploadPart(partNumber: number) {
      const start = (partNumber - 1) * chunkSize;
      const end = Math.min(file.size, partNumber * chunkSize);
      const blob = file.slice(start, end);

      // 预计算校验
      let checksumCRC32C = "";
      try { checksumCRC32C = await crc32cBase64(blob); } catch { }
      const contentMD5 = ""; // 可按需开启 md5Base64(blob)

      const signRes = await fetch("/api/s3/multipart/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 为避免与预签名的 SignedHeaders 不一致导致 403，这里不再通过服务器签名校验参数
        body: JSON.stringify({ key, uploadId, partNumber }),
      });
      if (!signRes.ok) throw new Error(await signRes.text());
      const { url } = await signRes.json() as { url: string };

      const t0 = performance.now();
      let attempts = 0;
      await retry(async () => {
        attempts += 1;
        const res = await fetch(url, { method: "PUT", body: blob, signal: controller.signal });
        if (!res.ok) throw new Error(`上传分片失败 ${partNumber}: ${res.status}`);
      });
      if (attempts > 1) setTotalRetries(prev => prev + (attempts - 1));
      const rtt = performance.now() - t0;
      // 记录 RTT
      const m = metricsRef.current;
      m.rttsMs.push(rtt);
      if (m.rttsMs.length > 30) m.rttsMs.shift();
      m.successes += 1;

      pendingPartsRef.current.delete(partNumber);
      uploadedBytesRef.current += blob.size;

      const now = performance.now();
      const dt = (now - lastTickRef.current) / 1000;
      if (dt >= 0.5) {
        const dBytes = uploadedBytesRef.current - lastBytesRef.current;
        const mbps = dBytes / dt / (1024 * 1024);
        // EWMA 平滑
        const alpha = 0.3;
        smoothedMbpsRef.current = smoothedMbpsRef.current > 0 ? (alpha * mbps + (1 - alpha) * smoothedMbpsRef.current) : mbps;
        setSpeed(`${smoothedMbpsRef.current.toFixed(2)} MB/s`);
        const remaining = totalBytesRef.current - uploadedBytesRef.current;
        const bytesPerSec = smoothedMbpsRef.current * 1024 * 1024;
        const secLeft = Math.max(0, remaining / (bytesPerSec || 1));
        const m = Math.floor(secLeft / 60), s = Math.floor(secLeft % 60);
        setEta(`${m}:${String(s).padStart(2, '0')}`);
        lastTickRef.current = now;
        lastBytesRef.current = uploadedBytesRef.current;
      }

      const percent = Math.round((uploadedBytesRef.current / totalBytesRef.current) * 100);
      setProgress(percent);
      if (activeIdx !== null) setQueue(prev => prev.map((it, i) => i === activeIdx ? { ...it, progress: percent } : it));
    }

    let active = 0;
    const trySpawn = () => {
      if (paused) return;
      while (active < curConcurrency && pendingPartsRef.current.size > 0) {
        const it = pendingPartsRef.current.values().next();
        const partNumber = it.value as number;
        active++;
        uploadPart(partNumber).then(() => {
          active--; trySpawn();
        }).catch((err) => {
          active--;
          const e2 = err as { name?: string };
          if (e2?.name === "AbortError" || controller.signal.aborted) {
            // no-op
          } else {
            pendingPartsRef.current.add(partNumber);
            setError(err instanceof Error ? err.message : String(err));
            metricsRef.current.failures += 1;
          }
        });
        pendingPartsRef.current.delete(partNumber);
      }
      if (active === 0 && pendingPartsRef.current.size === 0) {
        void completeUpload();
      }
    };

    trySpawn();

    // 自适应并发调度：每 2s 评估 RTT/失败率，动态增减并发
    if (metricsRef.current.adjustTimer) {
      window.clearInterval(metricsRef.current.adjustTimer);
    }
    metricsRef.current.adjustTimer = window.setInterval(() => {
      const m = metricsRef.current;
      if (paused || controller.signal.aborted) return;
      const samples = m.rttsMs.slice(-10);
      const avg = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
      const fail = m.failures; const succ = m.successes || 1;
      const failRate = fail / (fail + succ);
      let next = curConcurrency;
      // 调整规则：失败或 RTT>1200ms → 降 1；RTT<400ms 且无失败 → 升 1（抖动保护：至少 3s 间隔）
      const nowTs = Date.now();
      if (m.lastAdjustAt && nowTs - m.lastAdjustAt < 3000) {
        // skip adjust due to guard interval
      } else {
        if (failRate > 0.05 || avg > 1200) next = Math.max(1, curConcurrency - 1);
        else if (avg > 0 && avg < 400 && fail === 0) next = Math.min(10, curConcurrency + 1);
      }
      if (next !== curConcurrency) setCurConcurrency(next);
      // 滚动窗口清零失败计数，RTT 留作趋势
      m.failures = 0;
      m.successes = 0;
      m.lastAdjustAt = nowTs;
      // 网络状态标签
      let status = "--";
      if (avg > 0) {
        if (avg < 300 && failRate < 0.02) status = "良好";
        else if (avg < 800 && failRate < 0.05) status = "一般";
        else status = "较差";
      }
      setNetworkStatus(status);
    }, 2000);
  }

  async function completeUpload() {
    const info = currentUploadRef.current;
    if (!info) return;
    setStatus("合并分片...");

    const res = await fetch("/api/s3/multipart/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: info.key, uploadId: info.uploadId }) });
    const data = await res.json() as { parts: { PartNumber: number; ETag: string }[] };
    const completeRes = await fetch("/api/s3/multipart/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: info.key, uploadId: info.uploadId, parts: data.parts.map(p => ({ ETag: p.ETag, PartNumber: p.PartNumber })) }),
    });
    if (!completeRes.ok) throw new Error(await completeRes.text());

    const file = info.file!;
    try {
      const resumeKey = await computeResumeKey(file);
      localStorage.removeItem(`uploader:session:${resumeKey}`);
    } catch { }
    localStorage.removeItem(`uploader:session:${getLegacyFingerprint(file)}`);

    try {
      setStatus("生成封面...");
      const poster = await generatePosterFromFile(file, 1.5);
      setStatus("上传封面...");
      const base = info.key.split("/").at(-1)?.replace(/\.[^.]+$/, "") || "poster";
      await uploadPosterBlob(base, poster);
      // 预览由后端 Lambda/MediaConvert 生成，前端不再参与
      setStatus("已提交后台生成预览...");
    } catch { }

    try { await fetch("/api/s3/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: info.key }) }); } catch { }

    setStatus("完成");
    setUploading(false);
    if (activeIdx !== null) {
      setQueue(prev => prev.map((it, i) => i === activeIdx ? { ...it, status: "done", key: info.key, progress: 100 } : it));
      show({ kind: "success", title: "上传完成", description: queue[activeIdx]?.name });
    }
    currentUploadRef.current = null;
    controllerRef.current = null;

    onCompleted?.({ key: info.key });

    // 处理下一个
    processNext();
  }

  const onInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) enqueueFiles(Array.from(files));
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) enqueueFiles(files);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => e.preventDefault(), []);

  const onPause = useCallback(() => {
    setPaused(true);
    controllerRef.current?.abort();
    setStatus("已暂停");
    if (activeIdx !== null) setQueue(prev => prev.map((it, i) => i === activeIdx ? { ...it, status: "paused" } : it));
  }, [activeIdx]);

  const onResume = useCallback(() => {
    if (!currentUploadRef.current?.file) {
      processNext();
      return;
    }
    if (activeIdx !== null) setQueue(prev => prev.map((it, i) => i === activeIdx ? { ...it, status: "uploading" } : it));
    setPaused(false);
    void runUploadLoop();
  }, [activeIdx]);

  const onCancel = useCallback(async () => {
    controllerRef.current?.abort();
    setUploading(false);
    setStatus("已取消");
    const info = currentUploadRef.current;
    if (info) {
      try { await fetch("/api/s3/multipart/abort", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: info.key, uploadId: info.uploadId }) }); } catch { }
      if (info.file) {
        try {
          const resumeKey = await computeResumeKey(info.file);
          localStorage.removeItem(`uploader:session:${resumeKey}`);
        } catch { }
        localStorage.removeItem(`uploader:session:${getLegacyFingerprint(info.file)}`);
      }
    }
    currentUploadRef.current = null;
    controllerRef.current = null;
    if (activeIdx !== null) setQueue(prev => prev.map((it, i) => i === activeIdx ? { ...it, status: "error", message: "已取消" } : it));
    processNext();
  }, [activeIdx]);

  return (
    <div className="rounded-xl border border-slate-300 bg-slate-50 p-4" onDrop={onDrop} onDragOver={onDragOver}>
      <label htmlFor="enterprise-video-input" className="sr-only">选择视频</label>
      <input id="enterprise-video-input" ref={inputRef} type="file" multiple accept={accept} className="hidden" onChange={onInput} title="选择视频文件" />
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">企业级视频上传</div>
          <div className="text-xs text-slate-500">支持多分片/并发/断点续传/拖拽/取消/多文件队列</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">并发</span>
          <input type="range" aria-label="并发数" title="并发数" min={1} max={10} value={curConcurrency} onChange={(e) => setCurConcurrency(Number(e.target.value))} />
          <span className="w-4 text-right text-xs">{curConcurrency}</span>
          {!uploading && <button onClick={() => inputRef.current?.click()} className="rounded-lg bg-slate-900 px-3 py-2 text-white">选择文件</button>}
          {uploading && !paused && <button onClick={onPause} className="rounded-lg bg-slate-100 px-3 py-2 text-slate-900">暂停</button>}
          {uploading && paused && <button onClick={onResume} className="rounded-lg bg-emerald-500 px-3 py-2 text-white">继续</button>}
          {uploading && <button onClick={onCancel} className="rounded-lg bg-rose-100 px-3 py-2 text-rose-800">取消</button>}
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="h-2 rounded-md bg-slate-200">
          <div className="h-2 rounded-md bg-emerald-500 transition-[width] duration-200 ease-linear" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-slate-500">
          <span>进度：{progress}%（{speed}，剩余 {eta}） · 网络：{networkStatus} · 重试：{totalRetries}</span>
          <span>{status}</span>
        </div>
        {error && <div className="mt-2 text-rose-700">{error}</div>}
      </div>

      {queue.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 p-2 font-semibold">上传队列</div>
          <ul className="flex list-none flex-col gap-2 p-2">
            {queue.map((it, i) => (
              <li key={`${it.name}-${i}`} className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm">{it.name}</span>
                  <span className="text-xs text-slate-500">{it.status}{it.message ? ` · ${it.message}` : ''}</span>
                </div>
                <div className="min-w-40">
                  <div className="h-1.5 rounded bg-slate-200">
                    <div className={`h-1.5 rounded ${i === activeIdx ? 'bg-emerald-500' : 'bg-slate-400'}`} style={{ width: `${it.progress}%` }} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
} 