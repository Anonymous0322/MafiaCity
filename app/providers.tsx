"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getCopy, isLanguage, type Copy } from "@/lib/i18n";
import { translateError } from "@/lib/api/errors";
import {
  haptic,
  initWebApp,
  waitForTelegram,
  type TelegramWebApp,
} from "@/lib/telegram-sdk";
import type { Language, LobbyView, PlayerProfile } from "@/lib/types";

type AuthState = "loading" | "authenticated" | "unauthenticated" | "outside-telegram";

type AppContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Copy;
  status: AuthState;
  profile: PlayerProfile | null;
  authError: string | null;
  retryAuth: () => void;
  webApp: TelegramWebApp | null;
  botUsername: string;
  /** Set while a lobby/game view is mounted so the top bar can show context. */
  lobby: LobbyView | null;
  setLobby: (lobby: LobbyView | null) => void;
  notice: string;
  setNotice: (notice: string) => void;
  /** Sets the notice bar to a localised message for an API error code. */
  failWith: (code?: string, errorCode?: string) => void;
  /** Localised text for an API error code. */
  errorText: (code?: string, errorCode?: string) => string;
  buzz: (type?: Parameters<typeof haptic>[1]) => void;
  navigate: (href: string) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

const LANGUAGE_KEY = "mafia:language";

export function AppProviders({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("uz");
  const [status, setStatus] = useState<AuthState>("loading");
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(false);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      /* private mode */
    }
    document.documentElement.lang = next;
  }, []);

  // --- Telegram SDK + authentication ---------------------------------------
  useEffect(() => {
    let cancelled = false;
    mounted.current = true;

    async function bootstrap() {
      const app = await waitForTelegram();
      if (cancelled) return;

      // Language preference is applied once the SDK promise settles so the
      // first paint stays server-consistent.
      const stored = window.localStorage.getItem(LANGUAGE_KEY);
      const device = window.navigator.language?.slice(0, 2).toLowerCase();
      const preferred = isLanguage(stored) ? stored : isLanguage(device) ? device : null;
      if (preferred) setLanguageState(preferred);

      setWebApp(app ?? null);
      initWebApp(app);

      const initData = app?.initData;
      if (!initData) {
        // Outside Telegram: try the existing HttpOnly session cookie so a
        // desktop preview still works for whoever already logged in.
        setStatus("outside-telegram");
        setAuthError("init_data_missing");
        return;
      }

      setStatus("loading");
      try {
        const response = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            initData,
            language: preferred ?? undefined,
          }),
        });
        const payload = (await response.json()) as {
          player?: PlayerProfile;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !payload.player) {
          setStatus("unauthenticated");
          setAuthError(payload.error ?? "auth_failed");
          return;
        }
        setProfile(payload.player);
        setAuthError(null);
        setStatus("authenticated");
        if (!preferred && isLanguage(payload.player.language)) {
          setLanguageState(payload.player.language);
        }
      } catch {
        if (cancelled) return;
        setStatus("unauthenticated");
        setAuthError("network");
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // --- document chrome ------------------------------------------------------
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const buzz = useCallback(
    (type: Parameters<typeof haptic>[1] = "light") => {
      haptic(webApp ?? undefined, type);
    },
    [webApp],
  );

  const navigate = useCallback((href: string) => {
    if (typeof window === "undefined") return;
    window.location.assign(href);
  }, []);

  const copy = getCopy(language);

  const errorText = useCallback(
    (code?: string, errorCode?: string) => {
      const key = translateError(code, errorCode);
      return (copy as Record<string, string>)[key] ?? copy.generic;
    },
    [copy],
  );

  const failWith = useCallback(
    (code?: string, errorCode?: string) => {
      setNotice(errorText(code, errorCode));
    },
    [errorText],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      language,
      setLanguage,
      t: copy,
      status,
      profile,
      authError,
      retryAuth: () => {
        setStatus("loading");
        setAuthError(null);
        setAttempt((count) => count + 1);
      },
      webApp,
      botUsername: process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "mafiauz_robot",
      lobby,
      setLobby,
      notice,
      setNotice,
      failWith,
      errorText,
      buzz,
      navigate,
    }),
    [language, setLanguage, copy, status, profile, authError, webApp, lobby, notice, failWith, errorText, buzz, navigate],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside <AppProviders>");
  return context;
}
