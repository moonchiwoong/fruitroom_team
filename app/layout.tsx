import TeamAuth from '@/components/team-auth';
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "과실연구소 | 사과 초기 품질 예측·저장 관리",
  description: "산지 기상 조건으로 사과의 초기 품질을 예측하고, 저장 물량의 환경·품질·사진 기록을 관리합니다.",
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
