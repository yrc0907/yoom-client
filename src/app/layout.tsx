import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
    <html lang="zh-CN">
      <head>
        {PRECONNECT && <link rel="preconnect" href={PRECONNECT} crossOrigin="anonymous" />}
        {CDN_PRECONNECT && <link rel="preconnect" href={CDN_PRECONNECT} crossOrigin="anonymous" />}
        {PRECONNECT && <link rel="dns-prefetch" href={PRECONNECT} />}
        {CDN_PRECONNECT && <link rel="dns-prefetch" href={CDN_PRECONNECT} />}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
