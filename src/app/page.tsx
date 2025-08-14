"use client";
import dynamic from "next/dynamic";
const EnterpriseUploader = dynamic(() => import("./components/EnterpriseUploader"), { ssr: false, loading: () => null });
import VideoGallery from "./components/VideoGallery";
import { ToastProvider } from "./components/ToastCenter";
import { useEffect } from "react";

function SWRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    // 在开发环境禁用 SW，避免旧缓存导致 Hydration 不一致
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => { });
    }
  }, []);
  return null;
}

export default function Home() {
  // removed web-vitals reporting per request
  return (
    <ToastProvider>
      <SWRegister />
      <main className="p-6 md:p-8" style={{}}>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold mb-3">视频上传到 AWS S3</h1>
          <button
            onClick={() => { try { localStorage.removeItem("token"); } catch { } window.location.assign("/auth/login"); }}
            className="inline-flex items-center justify-center rounded-md bg-red-500 px-3 py-1.5 text-white text-sm hover:bg-red-600"
          >退出登录</button>
        </div>
        <EnterpriseUploader />
        <VideoGallery />
      </main>
    </ToastProvider>
  )
}
