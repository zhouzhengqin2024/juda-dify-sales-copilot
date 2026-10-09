import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "据答 | 企业 AI 客服售前核对",
  description: "核对模拟企业 AI 客服产品资料中的能力、限制、未知项与部分软件年费。",
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
