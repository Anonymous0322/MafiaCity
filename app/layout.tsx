import type { Metadata, Viewport } from "next";
import TelegramSdk from "@/app/telegram-sdk";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mafia — tungi shahar",
  description: "Telegram ichida do‘stlar bilan Mafia o‘yinini o‘ynang.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz">
      <body>
        {children}
        <TelegramSdk />
      </body>
    </html>
  );
}
