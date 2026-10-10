import type { Metadata, Viewport } from "next";
import TelegramSdk from "@/app/telegram-sdk";
import { AppProviders } from "@/app/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mafia City — Tungi shahar",
  description: "Telegram ichida do‘stlar bilan Mafia o‘yinini o‘ynang.",
  applicationName: "Mafia City",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#151310",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz">
      <body>
        <AppProviders>{children}</AppProviders>
        <TelegramSdk />
      </body>
    </html>
  );
}
