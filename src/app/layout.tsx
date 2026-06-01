import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "@/lib/logger"; // 激活服务端日志拦截
import { Navbar } from "@/components/Navbar";
import { ThemeProvider } from "@/components/ThemeProvider";
import LogPanel from "@/components/LogPanel";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "COCO音乐下载站",
  description: "简约纯净的音乐下载工具",
  icons: {
    icon: "/logo.svg",
  },
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const downloadEnabled = process.env.ENABLE_DOWNLOAD !== "0";
  const announcementEnabled =
    !downloadEnabled && (process.env.ANNOUNCEMENT_ENABLED ?? "1") === "1";
  const announcementText =
    process.env.ANNOUNCEMENT_TEXT ??
    "由于本站当前流量包达到上限，下载功能已临时关闭，将为你跳转到原链接。";
  const clientEnv = {
    ENABLE_DOWNLOAD: downloadEnabled ? "1" : "0",
    ANNOUNCEMENT_ENABLED: announcementEnabled ? "1" : "0",
    ANNOUNCEMENT_TEXT: announcementText,
    HAS_SAVE_PATH: process.env.SAVE_PATH ? "1" : "0",
  };

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-50 dark:bg-slate-950 transition-colors duration-300`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <script
            dangerouslySetInnerHTML={{
              __html: `window.__COCO_ENV=${JSON.stringify(clientEnv)};`,
            }}
          />
          <div className="sticky top-0 z-[60] w-full flex flex-col">
            {announcementEnabled ? (
              <div className="w-full bg-orange-50/90 dark:bg-orange-950/90 border-b border-orange-100 dark:border-orange-900 px-4 py-2 text-center text-xs sm:text-sm text-orange-800 dark:text-orange-200 flex flex-wrap items-center justify-center gap-1 backdrop-blur-sm transition-colors duration-300">
                <span>{announcementText}</span>
              </div>
            ) : null}
            <Navbar />
          </div>
          <div className="min-h-screen">{children}</div>
          <LogPanel />
        </ThemeProvider>
      </body>
    </html>
  );
}
