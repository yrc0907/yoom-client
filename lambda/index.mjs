import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createWriteStream, createReadStream, promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import path from "node:path";

// Env
const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.BUCKET;
const IN_PREFIX = process.env.INPUT_PREFIX || "uploads/videos/";
const OUT_PREFIX = process.env.OUTPUT_PREFIX || "previews-vtt/";
const INTERVAL = Number(process.env.INTERVAL_SEC || 2);
const WIDTH = Number(process.env.WIDTH_PX || 240);
const MAX_FRAMES = Number(process.env.MAX_FRAMES || 300);

// ffmpeg 路径：优先环境变量（/var/task/bin/ffmpeg），否则使用 layer 的 /opt/bin/ffmpeg
const ffmpegPath = process.env.FFMPEG_PATH || "/opt/bin/ffmpeg";

export const handler = async (event) => {
  const rec = event?.Records?.[0];
  if (!rec) return;
  const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));
  if (!key.startsWith(IN_PREFIX) || !key.endsWith(".mp4")) return;

  const base = path.basename(key).replace(/\.[^.]+$/, "");
  const workDir = "/tmp/" + base;
  await fs.mkdir(workDir, { recursive: true });
  const localMp4 = path.join(workDir, base + ".mp4");

  // 1) 下载视频
  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await pipeline(obj.Body, createWriteStream(localMp4));

  // 2) 抽帧到 /tmp/{base}/%03d.jpg
  const jpgPattern = path.join(workDir, "%03d.jpg");
  // 确保可执行权限（ZIP 在 Windows 打包可能丢失 x 位）
  try { await exec("chmod", ["+x", ffmpegPath]); } catch { }
  await exec(ffmpegPath, [
    "-y", "-i", localMp4,
    "-vf", `fps=1/${INTERVAL},scale=${WIDTH}:-2`,
    "-frames:v", String(MAX_FRAMES),
    jpgPattern,
  ]);

  // 3) 生成 VTT（逐帧）
  const durationSec = await probeDuration(localMp4, ffmpegPath);
  const files = (await fs.readdir(workDir)).filter(f => f.endsWith(".jpg")).sort();
  let vtt = "WEBVTT\n\n";
  let start = 0;
  for (let i = 0; i < files.length; i++) {
    const end = Math.min(durationSec, start + INTERVAL);
    vtt += `${fmt(start)} --> ${fmt(end)}\n${base}/${files[i]}\n\n`;
    start = end;
  }
  const vttPath = path.join(workDir, `${base}.vtt`);
  await fs.writeFile(vttPath, vtt, "utf8");

  // 4) 上传 VTT 与 JPG
  await putS3(`${OUT_PREFIX}${base}.vtt`, createReadStream(vttPath), "text/vtt");
  for (const f of files) {
    await putS3(`${OUT_PREFIX}${base}/${f}`, createReadStream(path.join(workDir, f)), "image/jpeg");
  }

  // 清理
  await fs.rm(workDir, { recursive: true, force: true });
};

async function putS3(Key, Body, ContentType) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body, ContentType }));
}

function fmt(sec) {
  const s = Math.floor(sec);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}.000`;
}

async function exec(cmd, args) {
  await new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", d => err += d.toString());
    p.on("close", code => code === 0 ? res(null) : rej(new Error(err || `code=${code}`)));
  });
}

async function probeDuration(file, ffmpeg) {
  const out = await new Promise((res) => {
    const p = spawn(ffmpeg, ["-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let s = ""; p.stderr.on("data", d => s += d.toString()); p.on("close", () => res(s));
  });
  const m = String(out).match(/Duration:\s(\d+):(\d+):(\d+)\./);
  if (!m) return 0;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}


