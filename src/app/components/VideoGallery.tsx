"use client";

import { useEffect, useMemo, useState } from "react";
import VideoPlayer from "@/app/components/VideoPlayer";
import HoverVideo from "@/app/components/HoverVideo";

// 类型定义

type FolderItem = {
  name: string;
  prefix: string;
};

type VideoItem = {
  key: string;
  url: string;
  hlsUrl?: string | null;
  posterUrl?: string | null;
  previewUrl?: string | null;
  preview360Url?: string | null;
  animUrl?: string | null;
  thumbsBase?: string | null;
  size?: number;
  lastModified?: string;
};

export type ListResponse = {
  folders: FolderItem[];
  files: VideoItem[];
  nextToken: string | null;
  expires: number;
};

type VideoGalleryProps = {
  listLoader?: (token: string | null, limit: number) => Promise<ListResponse>;
};

export default function VideoGallery({ listLoader }: VideoGalleryProps) {
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<VideoItem[]>([]);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [expires, setExpires] = useState<number>(600);
  const [openedKey, setOpenedKey] = useState<string | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderToDelete, setFolderToDelete] = useState<FolderItem | null>(null);
  const [videoToMove, setVideoToMove] = useState<VideoItem | null>(null);

  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    const parts = currentPath.split("/").filter(p => p);
    return parts.map((part, i) => {
      const path = parts.slice(0, i + 1).join("/") + "/";
      return { name: part, path };
    });
  }, [currentPath]);

  const moveTargetFolders = useMemo(() => {
    const options: { name: string, prefix: string }[] = [];
    // Add parent directory option if not in root
    if (currentPath) {
      const parentPath = currentPath.split('/').slice(0, -2).join('/') + '/';
      options.push({ name: "../ (Parent Folder)", prefix: parentPath });
    }
    // Add current level folders
    folders.forEach(f => options.push({ name: f.name, prefix: f.prefix }));
    return options;
  }, [folders, currentPath]);

  // 预览策略：auto/360/480；帧预览：auto/sprite/frame
  const [previewStrategy, setPreviewStrategy] = useState<"auto" | "360" | "480">("auto");
  const [vttMode, setVttMode] = useState<"auto" | "sprite" | "frame">("auto");

  const limit = useMemo(() => 12, []);

  async function load(path: string, token?: string | null) {
    setLoading(true);
    setError(null);
    try {
      if (listLoader) {
        const data = await listLoader(token ?? null, limit);
        setFolders(token ? (prev) => [...prev, ...data.folders] : data.folders);
        setFiles(token ? (prev) => [...prev, ...data.files] : data.files);
        setNextToken(data.nextToken);
        setExpires(data.expires ?? 600);
      } else {
        const url = new URL("/api/s3/videos", window.location.origin);
        url.searchParams.set("limit", String(limit));
        url.searchParams.set("expires", "600");
        url.searchParams.set("includeHls", "1");
        if (token) url.searchParams.set("token", token);
        if (path) url.searchParams.set("path", path);

        const jwt = localStorage.getItem("token") || "";
        const res = await fetch(url.toString(), { cache: "no-store", headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as ListResponse;
        setFolders(token ? (prev) => [...prev, ...data.folders] : data.folders);
        setFiles(token ? (prev) => [...prev, ...data.files] : data.files);
        setNextToken(data.nextToken);
        setExpires(data.expires ?? 600);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "加载失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(currentPath, null); }, [currentPath]);

  function handlePathChange(newPath: string) {
    setCurrentPath(newPath);
    setFolders([]);
    setFiles([]);
    setNextToken(null);
  }

  async function handleCreateFolder() {
    if (!newFolderName) return;
    setLoading(true);
    try {
      const jwt = localStorage.getItem("token") || "";
      const res = await fetch("/api/s3/folders", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...(jwt && { Authorization: `Bearer ${jwt}` })
        },
        body: JSON.stringify({ path: currentPath, folderName: newFolderName }),
      });
      if (!res.ok) throw new Error(await res.text());
      setShowCreateFolder(false);
      setNewFolderName("");
      load(currentPath, null); // Refresh
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "创建失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteFolder() {
    if (!folderToDelete) return;
    setLoading(true);
    try {
      const jwt = localStorage.getItem("token") || "";
      const url = new URL("/api/s3/folders", window.location.origin);
      url.searchParams.set("prefix", folderToDelete.prefix);
      const res = await fetch(url.toString(), {
        method: "DELETE",
        headers: {
          ...(jwt && { Authorization: `Bearer ${jwt}` })
        }
      });
      if (!res.ok) throw new Error(await res.text());
      setFolderToDelete(null);
      load(currentPath, null); // Refresh
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "删除失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleMoveVideo(destinationPrefix: string) {
    if (!videoToMove) return;
    setLoading(true);
    try {
      const jwt = localStorage.getItem("token") || "";
      const res = await fetch("/api/s3/move", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(jwt && { Authorization: `Bearer ${jwt}` })
        },
        body: JSON.stringify({ sourceKey: videoToMove.key, destinationPrefix }),
      });
      if (!res.ok) throw new Error(await res.text());
      setVideoToMove(null);
      load(currentPath, null); // Refresh
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "移动失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // 手动轻量预取：对首屏前三个用 Range 拉取前 64KB
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const first = files.slice(0, 3);
        await Promise.all(first.map(async (it) => {
          const fallback = `/api/s3/proxy?key=${encodeURIComponent(it.key)}&expires=600`;
          const href = it.preview360Url || it.previewUrl || fallback;
          await fetch(href, { headers: { Range: "bytes=0-65535" }, signal: controller.signal });
        }));
      } catch { }
    })();
    return () => controller.abort();
  }, [files]);

  const prefetchCount = 6;

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ marginBottom: 12 }}>
        <nav aria-label="breadcrumb" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <button onClick={() => handlePathChange("")} style={{ cursor: "pointer", background: "none", border: "none", color: "black", textDecoration: "underline", fontFamily: 'monospace' }}>Home</button>
          {breadcrumbs.map(crumb => (
            <span key={crumb.path} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: 'monospace' }}>/</span>
              <button onClick={() => handlePathChange(crumb.path)} style={{ cursor: "pointer", background: "none", border: "none", color: "black", textDecoration: "underline", fontFamily: 'monospace' }}>{crumb.name}</button>
            </span>
          ))}
        </nav>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>已上传视频</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label htmlFor="sel-quality" style={{ fontSize: 12, fontFamily: 'monospace' }}>预览清晰度</label>
          <select id="sel-quality" value={previewStrategy} onChange={(e) => setPreviewStrategy(e.target.value as "auto" | "360" | "480")} style={{ padding: "2px 6px", border: "1px solid black", background: 'white' }}>
            <option value="auto">自动</option>
            <option value="360">360p</option>
            <option value="480">480p</option>
          </select>
          <label htmlFor="sel-vtt" style={{ fontSize: 12, fontFamily: 'monospace' }}>帧预览</label>
          <select id="sel-vtt" value={vttMode} onChange={(e) => setVttMode(e.target.value as "auto" | "sprite" | "frame")} style={{ padding: "2px 6px", border: "1px solid black", background: 'white' }}>
            <option value="auto">自动</option>
            <option value="sprite">雪碧图</option>
            <option value="frame">逐帧</option>
          </select>
          <button onClick={() => setShowCreateFolder(true)} style={{ background: "white", color: "black", border: "1px solid black", padding: "8px 12px", cursor: "pointer", boxShadow: "2px 2px 0px black" }}>
            创建文件夹
          </button>
          <button onClick={() => load(currentPath, null)} disabled={loading} style={{ background: "white", color: "black", border: "1px solid black", padding: "6px 10px", cursor: loading ? "not-allowed" : "pointer", boxShadow: "2px 2px 0px black" }}>
            刷新
          </button>
        </div>
      </div>

      {error && (<div style={{ marginTop: 8, color: "red" }}>{error}</div>)}

      {showCreateFolder && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", padding: 24, border: "2px solid black", boxShadow: "4px 4px 0px black", width: 400 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, fontFamily: 'monospace' }}>创建新文件夹</h3>
            <input 
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="文件夹名称"
              style={{ width: "100%", padding: 8, border: "1px solid black", marginBottom: 16, boxSizing: 'border-box', fontFamily: 'monospace' }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setShowCreateFolder(false)} style={{ background: "white", color: "black", border: "1px solid black", padding: "8px 12px", cursor: "pointer", boxShadow: "2px 2px 0px black" }}>
                取消
              </button>
              <button onClick={handleCreateFolder} disabled={loading} style={{ background: "white", color: "black", border: "1px solid black", padding: "8px 12px", cursor: loading ? "not-allowed" : "pointer", boxShadow: "2px 2px 0px black" }}>
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {folderToDelete && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", padding: 24, border: "2px solid black", boxShadow: "4px 4px 0px black", width: 400 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, fontFamily: 'monospace' }}>确认删除</h3>
            <p style={{ fontFamily: 'monospace' }}>你确定要删除文件夹 \"{folderToDelete.name}\" 吗？此操作无法撤销。</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setFolderToDelete(null)} style={{ background: "white", color: "black", border: "1px solid black", padding: "8px 12px", cursor: "pointer", boxShadow: "2px 2px 0px black" }}>
                取消
              </button>
              <button onClick={handleDeleteFolder} disabled={loading} style={{ background: "black", color: "white", border: "1px solid black", padding: "8px 12px", cursor: loading ? "not-allowed" : "pointer", boxShadow: "2px 2px 0px #555" }}>
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {videoToMove && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", padding: 24, border: "2px solid black", boxShadow: "4px 4px 0px black", width: 400 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, fontFamily: 'monospace' }}>移动视频</h3>
            <p style={{ marginBottom: 8, fontFamily: 'monospace' }}>移动 \"{videoToMove.key.split('/').pop()}\" 到:</p>
            <select 
              id="move-dest-select"
              style={{ width: "100%", padding: 8, border: "1px solid black", marginBottom: 16, boxSizing: 'border-box', background: 'white', fontFamily: 'monospace' }}
              defaultValue={moveTargetFolders.length > 0 ? moveTargetFolders[0].prefix : ""}
            >
              {moveTargetFolders.map(f => <option key={f.prefix} value={f.prefix}>{f.name}</option>)}
            </select>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setVideoToMove(null)} style={{ background: "white", color: "black", border: "1px solid black", padding: "8px 12px", cursor: "pointer", boxShadow: "2px 2px 0px black" }}>
                取消
              </button>
              <button 
                onClick={() => {
                  const select = document.getElementById('move-dest-select') as HTMLSelectElement;
                  handleMoveVideo(select.value);
                }}
                disabled={loading}
                style={{ background: "white", color: "black", border: "1px solid black", padding: "8px 12px", cursor: loading ? "not-allowed" : "pointer", boxShadow: "2px 2px 0px black" }}
              >
                移动
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ height: 0, overflow: "hidden" }} aria-hidden>
        {files.slice(0, prefetchCount).map((it) => {
          const fallback = `/api/s3/proxy?key=${encodeURIComponent(it.key)}&expires=600`;
          const preview = it.preview360Url || it.previewUrl || fallback;
          return <link key={it.key} rel="prefetch" href={preview} as="video" />;
        })}
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 20 }}>
        {folders.map(folder => (
          <div key={folder.prefix} style={{ position: "relative", border: "1px solid black", background: "white" }}>
            <div onClick={() => handlePathChange(folder.prefix)} style={{ cursor: "pointer", padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.22A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path></svg>
              <span style={{ fontFamily: 'monospace' }}>{folder.name}</span>
            </div>
            <button onClick={(e) => { e.stopPropagation(); setFolderToDelete(folder); }} style={{ position: "absolute", top: 8, right: 8, background: "white", border: "1px solid black", cursor: "pointer", padding: 4, boxShadow: "2px 2px 0px black" }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
          </div>
        ))}
        {files.map((it) => {
          const playing = openedKey === it.key;
          const fallback = `/api/s3/proxy?key=${encodeURIComponent(it.key)}&expires=600`;
          const preview480 = it.previewUrl || fallback;
          const preview360 = it.preview360Url || it.previewUrl || fallback;
          return (
            <div key={it.key} style={{ position: "relative", overflow: "hidden", background: "#000", aspectRatio: "16/9", border: "1px solid black" }}>
              {playing ? (
                <VideoPlayer
                  src={it.hlsUrl || it.url}
                  storageId={it.key}
                  poster={it.posterUrl || undefined}
                  expiresAt={Date.now() + expires * 1000}
                  thumbsBase={it.thumbsBase || undefined}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                  onRequestRefreshUrl={async () => {
                    const u = new URL("/api/s3/signed-url", window.location.origin);
                    u.searchParams.set("key", it.key);
                    u.searchParams.set("expires", String(expires));
                    const jwt = localStorage.getItem("token") || "";
                    const res = await fetch(u.toString(), { headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined });
                    if (!res.ok) throw new Error(await res.text());
                    const data = (await res.json()) as { url: string };
                    return data.url;
                  }}
                />
              ) : (
                <>
                  <div style={{ position: "absolute", top: 8, right: 8, zIndex: 10, display: "flex", gap: 4 }}>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setVideoToMove(it); }}
                      style={{ background: "white", color: "black", border: "1px solid black", padding: "4px 8px", cursor: "pointer", boxShadow: "2px 2px 0px black" }}
                    >
                      移动
                    </button>
                  </div>
                  <HoverVideo
                    src={it.url}
                    previewSrc={preview480}
                    preview360Src={preview360}
                    animSrc={it.animUrl || undefined}
                    thumbsBase={it.thumbsBase || undefined}
                    poster={it.posterUrl || undefined}
                    previewStrategy={previewStrategy}
                    vttMode={vttMode}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                    onClick={() => {
                      const u = new URL(`/video/${encodeURIComponent(it.key)}`, window.location.origin);
                      window.location.assign(u.toString());
                    }}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
        {nextToken && (
          <button onClick={() => load(currentPath, nextToken)} disabled={loading} style={{ background: "white", color: "black", border: "1px solid black", padding: "8px 12px", cursor: loading ? "not-allowed" : "pointer", boxShadow: "2px 2px 0px black" }}>加载更多</button>
        )}
      </div>
    </section>
  );
} 