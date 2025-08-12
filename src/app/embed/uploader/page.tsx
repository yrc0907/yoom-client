"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect } from "react";

// 动态按需加载上传组件，避免在未访问上传页时加载其依赖（含 wasm）
const EnterpriseUploader = dynamic(() => import("@/app/components/EnterpriseUploader"), { ssr: false, loading: () => null });

export default function EmbedUploaderPage() {
  const onCompleted = useCallback((p: { key: string }) => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "uploader:completed", payload: p }, "*");
    }
  }, []);

  useEffect(() => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "uploader:ready" }, "*");
    }
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", padding: 16 }}>
      <div style={{ width: 640, maxWidth: "100%" }}>
        <EnterpriseUploader onCompleted={onCompleted} />
        <div style={{ marginTop: 12, textAlign: "center", color: "#64748b", fontSize: 12 }}>将此页面以 iframe 嵌入任意站点，即可快速集成企业级上传</div>
      </div>
    </div>
  );
} 