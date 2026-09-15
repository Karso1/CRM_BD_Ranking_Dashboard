import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UP 每日业绩排名",
  description: "UP 内部每日业绩与代理排名看板。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
