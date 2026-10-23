import TeamAuth from '@/components/team-auth';
import type { Metadata } from "next";
import "./globals.css";
import "./refresh.css";
import "./tracker-refresh.css";
import "./lots-refresh.css";
import "./ai-assistant.css";

export const metadata: Metadata = {
  applicationName: "애플트랙",
  title: "애플트랙 — 사과 품질 예측·저장 관리",
  description: "애플트랙 by FarmBridge — 초기 품질부터 저장 중 변화까지. 초기 품질을 입력하고, 저장 기간에 따른 변화를 예측해 실제 측정값과 비교하세요.",
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
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      </head>
      <body className="antialiased"><TeamAuth>{children}</TeamAuth></body>
    </html>
  );
}
