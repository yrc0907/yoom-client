"use client";
import EnterpriseUploader from "./components/EnterpriseUploader";
import VideoGallery from "./components/VideoGallery";
import { ToastProvider } from "./components/ToastCenter";
import { useEffect } from "react";

function SWRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => { });
    }
  }, []);
  return null;
}

export default function Home() {
  return (
    <ToastProvider>
      <SWRegister />
      <main style={{ padding: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>视频上传到 AWS S3</h1>
        <EnterpriseUploader />
        <VideoGallery />
      </main>
    </ToastProvider>
  )
}
