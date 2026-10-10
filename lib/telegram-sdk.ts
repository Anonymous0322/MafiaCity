export type TelegramWebAppUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
};

export type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: { user?: TelegramWebAppUser; start_param?: string };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  ready(): void;
  expand(): void;
  close(): void;
  enableClosingConfirmation?(): void;
  disableVerticalSwipes?(): void;
  requestFullscreen?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  onEvent(event: string, handler: () => void): void;
  offEvent(event: string, handler: () => void): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
  BackButton?: {
    isVisible: boolean;
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  };
  MainButton?: {
    text: string;
    isVisible: boolean;
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  };
  CloudStorage?: {
    setItem(key: string, value: string, cb?: (err: string | null, ok?: boolean) => void): void;
    getItem(key: string, cb: (err: string | null, value?: string) => void): void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | undefined {
  if (typeof window === "undefined") return undefined;
  return window.Telegram?.WebApp;
}

/**
 * Resolves the SDK script. Resolves `undefined` when running outside Telegram
 * (or when the CDN is unreachable) so the UI can degrade gracefully instead of
 * hanging on a loading spinner.
 */
export function waitForTelegram(timeoutMs = 6000): Promise<TelegramWebApp | undefined> {
  if (typeof window === "undefined") return Promise.resolve(undefined);
  const existing = getWebApp();
  if (existing) return Promise.resolve(existing);

  return new Promise<TelegramWebApp | undefined>((resolve) => {
    let settled = false;
    const finish = (value: TelegramWebApp | undefined) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("telegram-webapp-ready", onReady);
      window.removeEventListener("telegram-webapp-unavailable", onUnavailable);
      resolve(value);
    };
    const onReady = () => finish(getWebApp());
    const onUnavailable = () => finish(undefined);
    const timer = window.setTimeout(() => finish(getWebApp()), timeoutMs);

    window.addEventListener("telegram-webapp-ready", onReady);
    window.addEventListener("telegram-webapp-unavailable", onUnavailable);
  });
}

/** Best-effort initialisation of the Mini App chrome. */
export function initWebApp(app: TelegramWebApp | undefined): void {
  if (!app) return;
  try {
    app.ready();
    app.expand();
    app.disableVerticalSwipes?.();
    app.setHeaderColor?.("#151310");
    app.setBackgroundColor?.("#151310");
  } catch {
    /* older SDK versions throw on optional methods */
  }
}

export function haptic(
  app: TelegramWebApp | undefined,
  type: "light" | "medium" | "heavy" | "select" | "success" | "error" | "warning" = "light",
): void {
  if (!app?.HapticFeedback) return;
  try {
    if (type === "select") app.HapticFeedback.selectionChanged();
    else if (type === "success" || type === "error" || type === "warning") {
      app.HapticFeedback.notificationOccurred(type);
    } else app.HapticFeedback.impactOccurred(type);
  } catch {
    /* not supported on this client */
  }
}
