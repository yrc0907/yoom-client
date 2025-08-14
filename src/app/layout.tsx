import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "yoom",
  description: "video upload",
};

const S3_REGION = process.env.AWS_REGION;
const S3_BUCKET = process.env.S3_BUCKET_NAME;
const PRECONNECT = process.env.NEXT_PUBLIC_S3_PRECONNECT || (S3_REGION && S3_BUCKET ? `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com` : undefined);
const CDN_PRECONNECT = process.env.NEXT_PUBLIC_CDN_PRECONNECT; // 可选：你的 CDN 域名

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {PRECONNECT && <link rel="preconnect" href={PRECONNECT} crossOrigin="anonymous" />}
        {CDN_PRECONNECT && <link rel="preconnect" href={CDN_PRECONNECT} crossOrigin="anonymous" />}
        {PRECONNECT && <link rel="dns-prefetch" href={PRECONNECT} />}
        {CDN_PRECONNECT && <link rel="dns-prefetch" href={CDN_PRECONNECT} />}
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="min-h-screen flex">
          <aside className="hidden md:flex w-56 shrink-0 flex-col border-r bg-white/60">
            <div className="px-4 py-4 text-sm font-semibold">Yoom</div>
            <nav className="px-2 py-2 grid gap-1 text-sm">
              <Link href="/" className="rounded-md px-3 py-2 hover:bg-slate-100">首页</Link>
              <Link href="/feed" className="rounded-md px-3 py-2 hover:bg-slate-100">发布区</Link>
              <Link href="/live" className="rounded-md px-3 py-2 hover:bg-slate-100">直播区</Link>
            </nav>
            <div className="mt-auto p-2 text-xs text-slate-500">v0.1</div>
          </aside>
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
