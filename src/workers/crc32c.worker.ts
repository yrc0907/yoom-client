/// <reference lib="webworker" />

// Precompute CRC32C (Castagnoli) table once in the worker context
const CRC32C_TABLE = new Uint32Array(256);
const CRC32C_POLY = 0x82F63B78;
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (CRC32C_POLY ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32C_TABLE[i] = c >>> 0;
}

function crc32cToBase64(buffer: ArrayBuffer): string {
  let crc = 0xFFFFFFFF;
  const view = new Uint8Array(buffer);
  for (let i = 0; i < view.length; i++) {
    crc = CRC32C_TABLE[(crc ^ view[i]) & 0xFF] ^ (crc >>> 8);
  }
  crc = (crc ^ 0xFFFFFFFF) >>> 0;
  // big-endian bytes then base64
  const bytes = new Uint8Array(4);
  bytes[0] = (crc >>> 24) & 0xFF;
  bytes[1] = (crc >>> 16) & 0xFF;
  bytes[2] = (crc >>> 8) & 0xFF;
  bytes[3] = crc & 0xFF;
  let s = "";
  for (let i = 0; i < 4; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

self.onmessage = (ev: MessageEvent) => {
  const { id, buffer } = ev.data as { id: number; buffer: ArrayBuffer };
  const base64 = crc32cToBase64(buffer);
  (self as unknown as Worker).postMessage({ id, base64 });
};

export { };


