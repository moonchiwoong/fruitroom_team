import TeamAuth from '@/components/team-auth';
import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./refresh.css";
import "./tracker-refresh.css";
import "./lots-refresh.css";
import "./ai-assistant.css";
import "./hongro.css";
import "./design-system.css";
import "./app-v2.css";

export const metadata: Metadata = {
  applicationName: "애플트랙",
  title: "애플트랙 — 사과 품질 예측·저장 관리",
  description: "애플트랙 by FarmBridge — 초기 품질부터 저장 중 변화까지. 초기 품질을 입력하고, 저장 기간에 따른 변화를 예측해 실제 측정값과 비교하세요.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "애플트랙", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#1f5f35" };

// 글자 크게: 첫 화면이 그려지기 전에 저장된 설정을 적용합니다(저장소를 못 쓰면 기본 크기).
const bigTextScript = "try{if(localStorage.getItem('appletrack:bigtext')==='1')document.documentElement.classList.add('big-text')}catch(e){}";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bigTextScript }} />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />

      </head>
      <body className="antialiased"><TeamAuth>{children}</TeamAuth></body>
    </html>
  );
}
