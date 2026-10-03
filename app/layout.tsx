import TeamAuth from '@/components/team-auth';
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "과실연구소 | 사과 저장 품질 관리",
  description: "물량별 환경·품질·사진 기록을 연결하고, 상세한 360° 과일 모형과 저장 조건을 살펴보세요.",
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
      <body className="antialiased"><TeamAuth>{children}</TeamAuth></body>
    </html>
  );
}
