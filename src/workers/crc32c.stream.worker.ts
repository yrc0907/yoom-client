/// <reference lib="webworker" />

// Incremental CRC32C (Castagnoli) for multiple concurrent contexts
type Ctx = { crc: number };
const CTX: Record<number, Ctx> = {};

let TABLE: Uint32Array | null = null;
const POLY = 0x82F63B78;
function ensureTable() {
  if (TABLE) return;
  TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (POLY ^ (c >>> 1)) : (c >>> 1);
    TABLE[i] = c >>> 0;
  }
}

function initCtx(id: number) {
  CTX[id] = { crc: 0xFFFFFFFF };
}

function updateCtx(id: number, chunk: Uint8Array) {
  const ctx = CTX[id];
  if (!ctx) return;
  ensureTable();
  let crc = ctx.crc >>> 0;
  for (let i = 0; i < chunk.length; i++) crc = (TABLE as Uint32Array)[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
  ctx.crc = crc >>> 0;
}

function finalizeCtx(id: number): string {
  const ctx = CTX[id];
  if (!ctx) return "";
  const crc = (ctx.crc ^ 0xFFFFFFFF) >>> 0;
  delete CTX[id];
  const b = new Uint8Array(4);
  b[0] = (crc >>> 24) & 0xff; b[1] = (crc >>> 16) & 0xff; b[2] = (crc >>> 8) & 0xff; b[3] = crc & 0xff;
  let s = ""; for (let i = 0; i < 4; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

// Optional WASM fast path (crc32c)
let wasmReady = false;
let wasmCrc: (acc: number, chunk: Uint8Array) => number = (acc, chunk) => acc;
async function tryInitWasm() {
  try {
    // dynamic import inside worker
    // @ts-ignore
    const mod: any = await import('fast-crc32c');
    const calc = mod?.calculate || mod?.default || mod?.crc32c;
    if (typeof calc === 'function') {
      wasmReady = true;
      wasmCrc = (acc: number, chunk: Uint8Array) => calc(chunk, acc >>> 0) >>> 0;
    }
  } catch { wasmReady = false; }
}
tryInitWasm();

self.onmessage = (ev: MessageEvent) => {
  const d = ev.data as { op: "init" | "update" | "finalize"; id: number; chunk?: ArrayBuffer };
  if (d.op === "init") {
    initCtx(d.id);
    (self as unknown as Worker).postMessage({ id: d.id, ok: true });
  } else if (d.op === "update") {
    if (d.chunk) {
      const u8 = new Uint8Array(d.chunk);
      const ctx = CTX[d.id];
      if (ctx) {
        if (wasmReady) {
          ctx.crc = wasmCrc(ctx.crc, u8);
        } else {
          updateCtx(d.id, u8);
        }
      }
    }
    (self as unknown as Worker).postMessage({ id: d.id, ok: true });
  } else if (d.op === "finalize") {
    const base64 = finalizeCtx(d.id);
    (self as unknown as Worker).postMessage({ id: d.id, base64 });
  }
};

export { };


