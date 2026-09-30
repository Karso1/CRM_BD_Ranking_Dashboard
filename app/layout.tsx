import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UPay Operations Platform",
  description: "A unified dashboard for UP Business, UPay Wallet, BD performance, and agent relationships.",
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
