"use client";
/*eslint-disable*/
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "./ToastCenter";

export type EnterpriseUploaderProps = {
  accept?: string;
  partSizeBytes?: number; // 默认 8MB
  concurrency?: number; // 默认 4
  onCompleted?: (payload: { key: string }) => void;
};

// 临时开关：如遇浏览器对流式上传支持不一致，可关闭以回退为 Blob 直传
const ENABLE_STREAMING_UPLOAD = false;
// 关闭 CRC32C 校验（避免 Worker/环境差异导致阻塞上传），需要时可开启
const ENABLE_CRC32C = false;
// 关闭本地 H3 代理，直接 PUT 到 S3 预签名 URL
const ENABLE_H3_PROXY = false;

// 检测浏览器是否支持以 ReadableStream 作为请求体上传（需要 duplex: 'half'）
let requestStreamsSupported: boolean | null = null;
function supportsRequestStreams(): boolean {
  if (requestStreamsSupported !== null) return requestStreamsSupported;
  try {
    // ReadableStream 不存在或不可用直接判定不支持
    // @ts-ignore
    if (typeof ReadableStream === 'undefined') { requestStreamsSupported = false; return requestStreamsSupported; }
    // 尝试构造一个带流式 body 的 Request（Chromium 需带 duplex: 'half'）
    const rs = new ReadableStream({ start(controller: any) { controller.close(); } });
    // @ts-ignore
    const req = new Request('https://example.com', { method: 'POST', body: rs as any, duplex: 'half' as any });
    requestStreamsSupported = !!req;
  } catch {
    requestStreamsSupported = false;
  }
  return requestStreamsSupported;
}

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

// 带超时的 fetch，默认 7000ms 超时
async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 7000): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(1000, timeoutMs));
  try {
    const res = await fetch(input, { ...init, signal: ac.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
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

async function sha256Hex(ab: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", ab);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

async function computeHeadTailHashes(file: File): Promise<{ headHash: string; tailHash: string }> {
  const HEAD_BYTES = 256 * 1024;
  const TAIL_BYTES = 256 * 1024;
  const headBlob = file.slice(0, Math.min(HEAD_BYTES, file.size));
  const tailStart = file.size > TAIL_BYTES ? file.size - TAIL_BYTES : 0;
  const tailBlob = file.slice(tailStart, file.size);
  const [headBuf, tailBuf] = await Promise.all([headBlob.arrayBuffer(), tailBlob.arrayBuffer()]);
  const [headHash, tailHash] = await Promise.all([sha256Hex(headBuf), sha256Hex(tailBuf)]);
  return { headHash, tailHash };
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
  // 记录用户期望的并发，用于在自动降级后恢复
  const desiredConcurrencyRef = useRef<number>(concurrency);
  const bgPrevConcurrencyRef = useRef<number | null>(null);
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
  const failedQueueRef = useRef<number[]>([]);
  const partRttMsRef = useRef<Map<number, number>>(new Map());
  const partFailRef = useRef<Map<number, { count: number; backoffUntil: number }>>(new Map());
  const streamingDisabledRef = useRef<boolean>(false);
  const inflightBytesRef = useRef<Map<number, number>>(new Map());

  // 令牌桶（字节级）用于限速与公平调度（同一实例内多分片共享）
  const tokenBucketRef = useRef<{ capacityBytes: number; tokensBytes: number; refillPerSec: number; lastRefillTs: number }>({
    capacityBytes: 4 * 1024 * 1024,
    tokensBytes: 4 * 1024 * 1024,
    refillPerSec: 4 * 1024 * 1024,
    lastRefillTs: performance.now(),
  });

  function setTargetThroughput(bytesPerSec: number) {
    const cap = Math.max(512 * 1024, Math.min(32 * 1024 * 1024, bytesPerSec));
    tokenBucketRef.current.capacityBytes = cap;
    tokenBucketRef.current.refillPerSec = cap;
  }

  function refillTokens() {
    const tb = tokenBucketRef.current;
    const now = performance.now();
    const dt = Math.max(0, (now - tb.lastRefillTs) / 1000);
    tb.lastRefillTs = now;
    tb.tokensBytes = Math.min(tb.capacityBytes, tb.tokensBytes + dt * tb.refillPerSec);
  }

  async function consumeTokens(size: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const tryTake = () => {
        refillTokens();
        if (tokenBucketRef.current.tokensBytes >= size) {
          tokenBucketRef.current.tokensBytes -= size;
          resolve();
          return;
        }
        setTimeout(tryTake, 20);
      };
      tryTake();
    });
  }

  // 前台/后台切换：后台时降到 1 并发，前台恢复
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        bgPrevConcurrencyRef.current = curConcurrency;
        setCurConcurrency(1);
      } else {
        const restore = bgPrevConcurrencyRef.current ?? desiredConcurrencyRef.current;
        setCurConcurrency(Math.max(1, restore));
        bgPrevConcurrencyRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [curConcurrency]);

  // 连接变化：弱网/省流时自动降并发
  useEffect(() => {
    const anyNav = (navigator as unknown) as Navigator & { connection?: any };
    const conn = anyNav?.connection;
    if (!conn) return;
    const applyByNetwork = () => {
      try {
        const et = String(conn.effectiveType || "");
        const down = Number(conn.downlink || 0);
        const save = Boolean(conn.saveData || false);
        let target = desiredConcurrencyRef.current;
        if (save) target = Math.min(target, 2);
        if (["slow-2g", "2g", "3g"].includes(et)) target = Math.min(target, 2);
        else if (down > 0 && down < 2) target = Math.min(target, 3);
        setCurConcurrency(Math.max(1, target));
        // 限速目标：弱网 1-3MB/s，普通网按下行带宽 60% 设置上限
        let bps = 2 * 1024 * 1024;
        if (["slow-2g", "2g"].includes(et)) bps = 1 * 1024 * 1024;
        else if (et === "3g") bps = 2 * 1024 * 1024;
        else if (down > 0) bps = Math.max(2 * 1024 * 1024, Math.min(20 * 1024 * 1024, down * 1024 * 1024 * 0.6));
        setTargetThroughput(bps);
      } catch { }
    };
    conn.addEventListener?.("change", applyByNetwork);
    applyByNetwork();
    return () => conn.removeEventListener?.("change", applyByNetwork);
  }, []);

  // CRC32C Web Worker 池（多 worker 并行）
  const crcWorkersRef = useRef<Worker[]>([]);
  const workerLoadsRef = useRef<number[]>([]); // 简单负载计数，用于挑选最空闲的 worker
  const nextWorkerMessageIdRef = useRef<number>(1);
  const workerPromisesRef = useRef<Map<number, { resolve: (v: string) => void; reject: (e: unknown) => void; widx: number }>>(new Map());

  useEffect(() => {
    // 初始化 worker 池（默认 2-4 个）
    if (!ENABLE_CRC32C) {
      // 明确关闭 CRC：不创建 worker
      crcWorkersRef.current = [];
      workerLoadsRef.current = [];
      return;
    }
    if (typeof window !== "undefined" && crcWorkersRef.current.length === 0) {
      try {
        const poolSize = Math.min(4, Math.max(2, Math.ceil(getDefaultConcurrency() / 2)));
        const ws: Worker[] = [];
        const loads: number[] = [];
        const CRC_WORKER_VERSION = "v2";
        for (let i = 0; i < poolSize; i++) {
          const workerUrl = new URL(`../../workers/crc32c.worker.ts?ver=${CRC_WORKER_VERSION}`, import.meta.url);
          const w = new Worker(workerUrl, { type: "module" });
          w.onmessage = (ev: MessageEvent) => {
            const { id, base64 } = ev.data as { id: number; base64: string };
            const entry = workerPromisesRef.current.get(id);
            if (entry) {
              workerPromisesRef.current.delete(id);
              // 归还负载
              workerLoadsRef.current[entry.widx] = Math.max(0, (workerLoadsRef.current[entry.widx] || 1) - 1);
              entry.resolve(base64);
            }
          };
          w.onerror = (ev) => {
            const err = new Error(`CRC32C worker error: ${ev.message}`);
            // 将属于该 worker 的请求全部拒绝并归还负载
            for (const [id, entry] of workerPromisesRef.current) {
              if (entry.widx === i) {
                workerPromisesRef.current.delete(id);
                workerLoadsRef.current[i] = Math.max(0, (workerLoadsRef.current[i] || 1) - 1);
                entry.reject(err);
              }
            }
          };
          ws.push(w); loads.push(0);
        }
        crcWorkersRef.current = ws;
        workerLoadsRef.current = loads;
      } catch {
        crcWorkersRef.current = [];
        workerLoadsRef.current = [];
      }
    }
    return () => {
      for (const w of crcWorkersRef.current) try { w.terminate(); } catch { }
      crcWorkersRef.current = [];
      workerLoadsRef.current = [];
      workerPromisesRef.current.clear();
    };
  }, []);

  // pick 函数无需导出，使用处已内联调用 inputRef

  async function listUploadedParts(key: string, uploadId: string): Promise<{ partNumbers: Set<number>; uploadedBytes: number }> {
    const res = await fetchWithTimeout("/api/s3/multipart/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, uploadId }) }, 6000);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json() as { parts: { PartNumber: number; ETag: string; Size?: number }[] };
    const setNums = new Set<number>();
    let uploadedBytes = 0;
    for (const p of data.parts) { setNums.add(p.PartNumber); uploadedBytes += p.Size || 0; }
    return { partNumbers: setNums, uploadedBytes };
  }

  function enqueueFiles(files: File[]) {
    if (files.length === 0) return;
    setQueue((prev) => {
      const next = [...prev, ...files.map<QueueItem>(f => ({ file: f, name: f.name, size: f.size, status: "pending" as const, progress: 0 }))];
      // 若当前无任务在跑，立即启动，避免依赖 setTimeout 在某些环境下被 throttle
      if (activeIdx === null) {
        setTimeout(() => { processNext(); }, 0);
      }
      return next;
    });
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

    // 重要：每次开始新文件前清空上一文件的分片状态，避免回退窗口/失败队列影响新会话
    failedQueueRef.current = [];
    partRttMsRef.current.clear();
    partFailRef.current.clear();
    pendingPartsRef.current.clear();
    inflightBytesRef.current.clear();
    uploadedBytesRef.current = 0;

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

    let skipList = false;
    if (!saved) {
      // 计算首尾哈希用于服务端去重
      let headHash: string | undefined;
      let tailHash: string | undefined;
      try {
        const ht = await computeHeadTailHashes(file);
        headHash = ht.headHash; tailHash = ht.tailHash;
      } catch { }
      setStatus("准备上传: 初始化会话...");
      const initRes = await fetchWithTimeout("/api/s3/multipart/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size, headHash, tailHash }),
      }, 6000);
      if (!initRes.ok) throw new Error(await initRes.text());
      const init = await initRes.json() as { key: string; uploadId: string | null; partSize: number; dedup?: boolean };
      key = init.key; uploadId = init.uploadId || ""; chunkSize = init.partSize || partSizeBytes;
      if (init.dedup) {
        // 命中秒传：直接完成
        currentUploadRef.current = null;
        controllerRef.current = null;
        setUploading(false);
        setStatus("秒传完成");
        if (activeIdx !== null) {
          setQueue(prev => prev.map((it, i) => i === activeIdx ? { ...it, status: "done", key: init.key, progress: 100 } : it));
          show({ kind: "success", title: "已秒传", description: queue[activeIdx]?.name });
        }
        onCompleted?.({ key: init.key });
        processNext();
        return;
      }
      // 刚刚新建的分片上传，无需列举分片，直接开始上传
      skipList = true;
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

    if (skipList) {
      // 新会话，直接从第一分片开始
      pendingPartsRef.current = new Set(Array.from({ length: totalParts }, (_, i) => i + 1));
      uploadedBytesRef.current = 0;
      setProgress(0);
    } else {
      try {
        setStatus("查询已上传分片...");
        const listed = await listUploadedParts(key!, uploadId!);
        // 若后端告知 NoSuchUpload，则重启会话（丢弃旧 uploadId）
        const anyListed: any = listed as any;
        if (anyListed && anyListed.noSuchUpload) {
          localStorage.removeItem(`uploader:session:${resumeKey}`);
          localStorage.removeItem(`uploader:session:${legacyKey}`);
          setStatus("会话失效，重新初始化...");
          // 重新走新会话路径
          pendingPartsRef.current = new Set(Array.from({ length: totalParts }, (_, i) => i + 1));
          uploadedBytesRef.current = 0;
          setProgress(0);
        } else {
          pendingPartsRef.current = new Set(Array.from({ length: totalParts }, (_, i) => i + 1).filter(n => !listed.partNumbers.has(n)));
          uploadedBytesRef.current = listed.uploadedBytes;
          setProgress(Math.round((uploadedBytesRef.current / file.size) * 100));
        }
      } catch (e) {
        // 列举失败时，回退为完整待传列表（保持断点续传在下次重试时生效）
        pendingPartsRef.current = new Set(Array.from({ length: totalParts }, (_, i) => i + 1));
        uploadedBytesRef.current = 0;
        setProgress(0);
      }
    }

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

    // 计算 crc32c（在 Web Worker 池中执行，输出 base64）
    async function crc32cBase64(blob: Blob): Promise<string> {
      if (!ENABLE_CRC32C) return "";
      const workers = crcWorkersRef.current;
      const buffer = await blob.arrayBuffer();
      // 无可用 worker 时，简单回退：不带校验（不发送校验头）
      if (!workers || workers.length === 0) {
        return "";
      }
      const id = nextWorkerMessageIdRef.current++;
      return new Promise<string>((resolve, reject) => {
        // 选择最空闲的 worker
        let widx = 0; let minLoad = Number.POSITIVE_INFINITY;
        for (let i = 0; i < workers.length; i++) {
          const load = workerLoadsRef.current[i] || 0;
          if (load < minLoad) { minLoad = load; widx = i; }
        }
        workerLoadsRef.current[widx] = (workerLoadsRef.current[widx] || 0) + 1;
        workerPromisesRef.current.set(id, { resolve, reject, widx });
        try {
          workers[widx].postMessage({ id, buffer }, [buffer]);
        } catch (e) {
          workerPromisesRef.current.delete(id);
          workerLoadsRef.current[widx] = Math.max(0, (workerLoadsRef.current[widx] || 1) - 1);
          reject(e);
        }
      });
    }

    // 预留 MD5 实现（当前不启用）

    // OPFS 分片缓存与后台续传队列
    async function getOpfsRoot() {
      // @ts-ignore
      if (!('storage' in navigator) || typeof (navigator as any).storage.getDirectory !== 'function') return null;
      // @ts-ignore
      return await (navigator as any).storage.getDirectory();
    }
    async function savePartToOpfs(resumeKey: string, partNumber: number, blob: Blob): Promise<string | null> {
      try {
        const root = await getOpfsRoot(); if (!root) return null;
        // "@ts-expect-error
        const uploader = await root.getDirectoryHandle('uploader', { create: true });
        //"@ts-expect-error
        const dir = await uploader.getDirectoryHandle(resumeKey, { create: true });
        const fh = await dir.getFileHandle(String(partNumber), { create: true });
        const ws = await fh.createWritable(); await ws.write(blob); await ws.close();
        return `uploader/${resumeKey}/${partNumber}`;
      } catch { return null; }
    }
    async function enqueueBackgroundPut(entry: { id: string; url: string; opfsPath?: string }) {
      try {
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const req = indexedDB.open('uploader', 1);
          req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' }); };
          req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
        });
        await new Promise<void>((res, rej) => {
          const tx = db.transaction('queue', 'readwrite'); const store = tx.objectStore('queue');
          store.put(entry); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
        });
        // 注册一次后台同步
        if (navigator.serviceWorker?.ready) {
          try { const reg = await navigator.serviceWorker.ready; await (reg as any).sync?.register('uploader-sync'); } catch { }
        }
      } catch { }
    }

    async function uploadPart(partNumber: number) {
      const start = (partNumber - 1) * chunkSize;
      const end = Math.min(file.size, partNumber * chunkSize);
      const blob = file.slice(start, end);

      // 预计算校验
      let checksumCRC32C = "";
      try { checksumCRC32C = await crc32cBase64(blob); } catch { }
      const contentMD5 = ""; // 可按需开启 md5Base64(blob)

      const signRes = await fetchWithTimeout("/api/s3/multipart/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 为避免与预签名的 SignedHeaders 不一致导致 403，这里不再通过服务器签名校验参数
        body: JSON.stringify({ key, uploadId, partNumber }),
      }, 6000);
      if (!signRes.ok) throw new Error(await signRes.text());
      const signed = await signRes.json() as { url: string; expiresIn?: number; signedAt?: number };
      let { url } = signed;

      const t0 = performance.now();
      let attempts = 0;
      let lastStatus: number | undefined;
      let lastIsNetworkError = false;
      let opfsPath: string | null = null;
      const rkey = await computeResumeKey(file);
      try {
        await retry(async () => {
          attempts += 1;
          // 将分片缓存至 OPFS，便于掉电/重启后后台续传
          try { opfsPath = opfsPath || await savePartToOpfs(rkey, partNumber, blob); } catch { }
          // ReadableStream 以减小内存峰值并利用 backpressure
          function streamFromBlob(b: Blob): ReadableStream<Uint8Array> | Blob {
            // @ts-ignore
            if (ENABLE_STREAMING_UPLOAD === false || streamingDisabledRef.current || typeof (b as any).stream !== 'function' || typeof ReadableStream === 'undefined' || !supportsRequestStreams()) return b;
            const CHUNK = 256 * 1024;
            let offset = 0;
            return new ReadableStream<Uint8Array>({
              pull(ctrl) {
                if (offset >= b.size) { ctrl.close(); return; }
                const next = b.slice(offset, Math.min(b.size, offset + CHUNK));
                offset += next.size;
                // 令牌桶，按 chunk 粒度公平调度
                consumeTokens(next.size).then(() => next.arrayBuffer().then((ab) => { ctrl.enqueue(new Uint8Array(ab)); }).catch((e) => ctrl.error(e)));
              }
            });
          }
          try {
            const body = streamFromBlob(blob);
            const target = ENABLE_H3_PROXY ? (`/api/upload/h3-put?to=${encodeURIComponent(url)}`) : url;
            const isStreamLike = typeof (body as any)?.getReader === 'function' ||
              (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream);
            let resStatus = 0;
            if (!isStreamLike && body instanceof Blob) {
              // Use XHR to get fine-grained progress for Blob bodies
              const xhr = new XMLHttpRequest();
              const onAbort = () => { try { xhr.abort(); } catch { } };
              controller.signal.addEventListener('abort', onAbort);
              try {
                const done = await new Promise<number>((resolve, reject) => {
                  xhr.open('PUT', target, true);
                  xhr.upload.onprogress = (evt) => {
                    if (evt.lengthComputable) {
                      inflightBytesRef.current.set(partNumber, evt.loaded);
                      const inFlight = Array.from(inflightBytesRef.current.values()).reduce((a, b) => a + b, 0);
                      const total = uploadedBytesRef.current + inFlight;
                      const percent = Math.round((total / totalBytesRef.current) * 100);
                      setProgress(percent);
                    }
                  };
                  xhr.onload = () => resolve(xhr.status);
                  xhr.onerror = () => reject(new Error('Network error during upload'));
                  xhr.onabort = () => reject(new Error('AbortError'));
                  xhr.send(body);
                });
                resStatus = done;
              } finally {
                controller.signal.removeEventListener('abort', onAbort);
                inflightBytesRef.current.delete(partNumber);
              }
            } else {
              const init: any = { method: 'PUT', body: body as any, signal: controller.signal };
              if (ENABLE_STREAMING_UPLOAD !== false && isStreamLike && supportsRequestStreams()) {
                init.duplex = 'half';
              }
              let res: Response;
              try {
                res = await fetch(target, init);
              } catch (err: any) {
                const msg = String(err?.message || err || '');
                const needFallback = /duplex/i.test(msg) || /streaming body/i.test(msg) || /Failed to execute 'fetch'/i.test(msg);
                if (!needFallback) throw err;
                streamingDisabledRef.current = true;
                const fallbackInit: RequestInit = { method: 'PUT', body: blob as any, signal: controller.signal };
                res = await fetch(target, fallbackInit);
              }
              resStatus = res.status;
              if (!res.ok) {
                const err: any = new Error(`上传分片失败 ${partNumber}: ${res.status}`);
                err.status = res.status;
                throw err;
              }
            }
            lastStatus = resStatus;
            if (!(resStatus >= 200 && resStatus < 300)) {
              const err: any = new Error(`上传分片失败 ${partNumber}: ${resStatus}`);
              err.status = resStatus;
              throw err;
            }
          } catch (e: any) {
            if ((e?.status === 403 || e?.status === 401) && !controller.signal.aborted) {
              // 预签名可能过期，重签并重试一次
              try {
                const re = await fetchWithTimeout("/api/s3/multipart/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, uploadId, partNumber }) }, 6000);
                if (re.ok) { const j = await re.json() as { url: string }; url = j.url; }
              } catch { }
            } else if ((e?.status === 404) && !controller.signal.aborted) {
              // 端点差异或临时签名问题，重签一次
              try {
                const re = await fetchWithTimeout("/api/s3/multipart/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, uploadId, partNumber }) }, 6000);
                if (re.ok) { const j = await re.json() as { url: string }; url = j.url; }
              } catch { }
            }
            lastIsNetworkError = !(e && typeof e.status === 'number');
            throw e;
          }
        });
      } catch (e) {
        // 失败：仅网络错误或 5xx 进入后台续传队列（排除 4xx，如 403 预签名过期）
        try {
          const retriable = lastIsNetworkError || (typeof lastStatus === 'number' && lastStatus >= 500);
          if (retriable) {
            await enqueueBackgroundPut({ id: `${rkey}:${partNumber}`, url, opfsPath: opfsPath || undefined });
          }
        } catch { }
        // 标记该分片在一定时间内回退到非流式上传
        const backoffMs = 60_000;
        partFailRef.current.set(partNumber, { count: (partFailRef.current.get(partNumber)?.count || 0) + 1, backoffUntil: Date.now() + backoffMs });
        throw e;
      }
      if (attempts > 1) setTotalRetries(prev => prev + (attempts - 1));
      const rtt = performance.now() - t0;
      // 记录 RTT
      const m = metricsRef.current;
      m.rttsMs.push(rtt);
      if (m.rttsMs.length > 30) m.rttsMs.shift();
      m.successes += 1;
      // 记录分片级 RTT
      partRttMsRef.current.set(partNumber, rtt);

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

    // 简单顺序上传路径：在并发设为 1 时，绕过复杂调度，按分片顺序逐个上传
    if (curConcurrency <= 1) {
      const ordered = Array.from(pendingPartsRef.current).sort((a, b) => a - b);
      for (const pn of ordered) {
        if (paused || controller.signal.aborted) break;
        pendingPartsRef.current.delete(pn);
        try { await uploadPart(pn); } catch (e) {
          // 顺序路径遇到错误：放回队列并中止，交由上层重试/用户操作
          pendingPartsRef.current.add(pn);
          throw e;
        }
      }
      if (pendingPartsRef.current.size === 0) {
        await completeUpload();
      }
      return;
    }

    let active = 0;
    // 立即启动一个分片，避免某些环境下初始调度未触发
    try {
      const first = (() => {
        for (const n of pendingPartsRef.current) { return n; }
        return null;
      })();
      if (first !== null) {
        pendingPartsRef.current.delete(first);
        active = 1;
        uploadPart(first).then(() => {
          active--; trySpawn();
        }).catch((err) => {
          active--;
          const e2 = err as { name?: string };
          if (e2?.name === "AbortError" || controller.signal.aborted) {
            // no-op
          } else {
            const status = (err as any)?.status as number | undefined;
            const isNetwork = (err as any)?.isNetworkError === true || status === undefined;
            const retriable = isNetwork || (typeof status === 'number' && status >= 500);
            if (retriable) failedQueueRef.current.push(first);
            setError(err instanceof Error ? err.message : String(err));
            metricsRef.current.failures += 1;
          }
        });
      }
    } catch { }
    const trySpawn = () => {
      if (paused) return;
      // 取下一个分片：优先失败队列（FIFO），否则取 pending 中编号最小的分片
      const dequeueNextPart = (): number | null => {
        if (failedQueueRef.current.length > 0) {
          const pn = failedQueueRef.current.shift()!;
          return pn;
        }
        if (pendingPartsRef.current.size > 0) {
          // 自适应调度：优先选择估计处理时间短的分片（最后一片尺寸更小），其次选择历史 RTT 更短者
          let best: number | null = null;
          let bestKey = Number.POSITIVE_INFINITY;
          let minBackoffUntil: number | null = null;
          for (const n of pendingPartsRef.current) {
            const pf = partFailRef.current.get(n);
            if (pf && pf.backoffUntil && Date.now() < pf.backoffUntil) {
              if (typeof pf.backoffUntil === 'number') {
                minBackoffUntil = minBackoffUntil === null ? pf.backoffUntil : Math.min(minBackoffUntil, pf.backoffUntil);
              }
              continue; // 处于回退窗口
            }
            const isLast = n === Math.ceil(file.size / chunkSize);
            const estSize = isLast ? (file.size - (n - 1) * chunkSize) : chunkSize;
            const rtt = partRttMsRef.current.get(n);
            const score = estSize + (rtt || 0); // 简单加权：以尺寸为主，RTT 为辅
            if (score < bestKey) { bestKey = score; best = n; }
          }
          if (best !== null) {
            pendingPartsRef.current.delete(best);
            return best;
          }
          if (active === 0 && minBackoffUntil && minBackoffUntil > Date.now()) {
            const delay = Math.min(5000, Math.max(50, minBackoffUntil - Date.now()));
            window.setTimeout(() => { trySpawn(); }, delay);
          }
        }
        return null;
      };

      // 至少保持 1 个活跃 worker，防止单文件/单分片时饿死
      const targetConcurrency = Math.max(1, curConcurrency);
      while (active < targetConcurrency) {
        const partNumber = dequeueNextPart();
        if (partNumber === null) break;
        active++;
        uploadPart(partNumber).then(() => {
          active--; trySpawn();
        }).catch((err) => {
          active--;
          const e2 = err as { name?: string };
          if (e2?.name === "AbortError" || controller.signal.aborted) {
            // no-op
          } else {
            // 将失败分片放入优先队列（仅网络错误或 5xx）
            const status = (err as any)?.status as number | undefined;
            const isNetwork = (err as any)?.isNetworkError === true || status === undefined;
            const retriable = isNetwork || (typeof status === 'number' && status >= 500);
            if (retriable) failedQueueRef.current.push(partNumber);
            setError(err instanceof Error ? err.message : String(err));
            metricsRef.current.failures += 1;
          }
        });
      }
      if (active === 0 && pendingPartsRef.current.size === 0) {
        if (failedQueueRef.current.length > 0) {
          // 触发一次重试调度，避免停滞
          window.setTimeout(() => { trySpawn(); }, 200);
          return;
        }
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
      // 双变量控制（简化版）：并发 PID（P+I），目标 RTT=600ms；暂不在单文件内调分片大小，仅记忆供下次文件参考
      const TARGET_RTT = 600;
      const err = avg > 0 ? (TARGET_RTT - avg) / TARGET_RTT : 0;
      // P 控制
      let delta = 0;
      delta += err * 2; // Kp=2（经验值）
      // I 控制（失败率作为“积分”信号的负反馈）
      delta += (0.5 - Math.min(0.5, failRate)) * 1.5;
      if (avg > 0 && delta > 0.5) next = Math.min(10, curConcurrency + 1);
      else if (avg > 0 && delta < -0.5) next = Math.max(1, curConcurrency - 1);
      // 失败或 RTT>1200ms → 立即降 1；RTT<300ms 且无失败 → 升 1（抖动保护：至少 3s 间隔）
      const nowTs = Date.now();
      if (m.lastAdjustAt && nowTs - m.lastAdjustAt < 3000) {
        // skip adjust due to guard interval
      } else {
        if (failRate > 0.05 || avg > 1200) next = Math.max(1, curConcurrency - 1);
        else if (avg > 0 && avg < 300 && fail === 0) next = Math.min(10, curConcurrency + 1);
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

    const res = await fetchWithTimeout("/api/s3/multipart/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: info.key, uploadId: info.uploadId }) }, 6000);
    const data = await res.json() as { parts: { PartNumber: number; ETag: string }[], noSuchUpload?: boolean };
    if (data.noSuchUpload) {
      // 会话丢失：直接返回并提示用户重试（上层会清理本地会话并重启）
      throw new Error("会话失效，请重试上传");
    }
    const completeRes = await fetchWithTimeout("/api/s3/multipart/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: info.key, uploadId: info.uploadId, parts: data.parts.map(p => ({ ETag: p.ETag, PartNumber: p.PartNumber })) }),
    }, 6000);
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

    try { await fetchWithTimeout("/api/s3/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: info.key }) }, 6000); } catch { }

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
      try { await fetchWithTimeout("/api/s3/multipart/abort", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: info.key, uploadId: info.uploadId }) }, 6000); } catch { }
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
          <input type="range" aria-label="并发数" title="并发数" min={1} max={10} value={curConcurrency} onChange={(e) => { const v = Number(e.target.value); desiredConcurrencyRef.current = v; setCurConcurrency(v); }} />
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