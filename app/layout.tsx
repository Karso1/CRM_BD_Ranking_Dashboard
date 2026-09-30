import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UPay 业务运营平台",
  description: "UP Business 与 UPay Wallet 业务数据、BD 与代理关系的统一看板。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: { url: "/upay-logo.png", type: "image/png" },
    shortcut: "/upay-logo.png",
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
