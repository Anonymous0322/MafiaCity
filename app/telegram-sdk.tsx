"use client";

import Script from "next/script";

/**
 * Loads the official Telegram Web App SDK exactly once and signals readiness
 * to the app through a DOM event, so client components can await it without
 * racing the script tag.
 */
export default function TelegramSdk() {
  return (
    <Script
      src="https://telegram.org/js/telegram-web-app.js?59"
      strategy="beforeInteractive"
      onLoad={() => {
        window.dispatchEvent(new Event("telegram-webapp-ready"));
      }}
      onReady={() => {
        window.dispatchEvent(new Event("telegram-webapp-ready"));
      }}
      onError={() => {
        window.dispatchEvent(new Event("telegram-webapp-unavailable"));
      }}
    />
  );
}
