"use client";

import Script from "next/script";

export default function TelegramSdk() {
  return (
    <Script
      src="https://telegram.org/js/telegram-web-app.js?59"
      strategy="afterInteractive"
      onReady={() => {
        window.dispatchEvent(new Event("telegram-webapp-ready"));
      }}
      onError={() => {
        window.dispatchEvent(new Event("telegram-webapp-unavailable"));
      }}
    />
  );
}