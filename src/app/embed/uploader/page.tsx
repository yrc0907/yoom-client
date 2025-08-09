"use client";

import EnterpriseUploader from "@/app/components/EnterpriseUploader";
import { useCallback, useEffect, useMemo } from "react";

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