"use client";

import React, { createContext, useContext, useMemo, useState } from "react";

type ToastKind = "info" | "success" | "error";

export type ToastItem = {
  id: string;
  kind: ToastKind;
  title?: string;
  description?: string;
  durationMs?: number;
};

type ToastContextValue = {
  show: (t: Omit<ToastItem, "id">) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const api = useMemo<ToastContextValue>(() => ({
    show: ({ kind, title, description, durationMs = 3000 }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const item: ToastItem = { id, kind, title, description, durationMs };
      setItems((prev) => [...prev, item]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), durationMs);
    },
  }), []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" style={{ position: "fixed", right: 16, top: 16, display: "flex", flexDirection: "column", gap: 8, zIndex: 1000 }}>
        {items.map((it) => (
          <div key={it.id} role="status" aria-label={it.title || it.kind}
            style={{ minWidth: 240, maxWidth: 360, padding: 12, borderRadius: 8, color: it.kind === "error" ? "#991b1b" : it.kind === "success" ? "#065f46" : "#1f2937", background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 2px 8px rgba(0,0,0,.06)" }}>
            {it.title && <div style={{ fontWeight: 600, marginBottom: 4 }}>{it.title}</div>}
            {it.description && <div style={{ fontSize: 12, color: "#6b7280" }}>{it.description}</div>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
} 