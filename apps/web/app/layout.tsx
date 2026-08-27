import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { AppProviders } from "./providers";

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    title: "见时 · 从行动中看见方向",
    description: "一款从任务与专注记录中学习，帮助你形成周复盘与长期方向的时间管理工具。",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "见时 · 从行动中看见方向",
      description: "认真做事，方向会慢慢浮现。",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1726, height: 911, alt: "见时 · 从行动中，看见方向。" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "见时 · 从行动中看见方向",
      description: "认真做事，方向会慢慢浮现。",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><AppProviders>{children}</AppProviders></body></html>;
}
