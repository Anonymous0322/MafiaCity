"use client";

import {
  BarChart3,
  Copy,
  Home,
  Loader2,
  Moon,
  Share2,
  Trophy,
  UsersRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/app/providers";

/* -------------------------------------------------------------------------- */
/* Avatar                                                                     */
/* -------------------------------------------------------------------------- */

export function Avatar({
  name,
  avatar,
  size = "normal",
  className = "",
}: {
  name: string;
  avatar?: string | null;
  size?: "normal" | "small" | "large" | "hero";
  className?: string;
}) {
  // A previous render may have loaded a different URL; reset the error state
  // when the source changes so a new photo is not stuck on the letter.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(avatar) && failedUrl !== avatar;

  return (
    <span className={`avatar avatar-${size} ${className}`} aria-label={name} role="img">
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatar as string}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(avatar as string)}
        />
      ) : (
        name.slice(0, 1).toLocaleUpperCase()
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Top bar                                                                    */
/* -------------------------------------------------------------------------- */

export function TopBar() {
  const { t, language, setLanguage, profile, status } = useApp();
  const pathname = usePathname();

  const nav: { href: string; label: string; icon: typeof Home }[] = [
    { href: "/", label: t.home, icon: Home },
    { href: "/profile", label: t.profile, icon: BarChart3 },
    { href: "/leaderboard", label: t.leaderboard, icon: Trophy },
  ];

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <Moon size={19} />
        </span>
        <div className="brand-text">
          <p className="eyebrow">{t.title}</p>
          <span className="brand-subtitle">{t.subtitle}</span>
        </div>
      </div>

      <div className="top-actions">
        {status === "loading" ? (
          <span className="auth-chip auth-chip-loading">
            <Loader2 size={13} className="spin" /> {t.loadingProfile}
          </span>
        ) : profile ? (
          <span className="auth-chip" title={profile.name}>
            <Avatar name={profile.name} avatar={profile.avatar} size="small" />
            <span className="auth-chip-name">{profile.name}</span>
          </span>
        ) : null}

        <div className="language-switch" role="group" aria-label="Language">
          {(["uz", "ru", "en"] as const).map((code) => (
            <button
              key={code}
              type="button"
              className={language === code ? "language-option is-active" : "language-option"}
              onClick={() => setLanguage(code)}
              aria-pressed={language === code}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <nav className="tabbar" aria-label="Primary">
        {nav.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/" ? pathname === "/" || pathname.startsWith("/lobby") || pathname.startsWith("/game") : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? "tab is-active" : "tab"}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Generic surfaces                                                           */
/* -------------------------------------------------------------------------- */

export function PageShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <main className="app-background">
      <div className={`game-app ${className}`}>{children}</div>
    </main>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div className="section-heading-text">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function Loader({ label }: { label: string }) {
  return (
    <div className="empty-state" role="status" aria-live="polite">
      <span className="loader" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon ? <span className="empty-icon">{icon}</span> : null}
      <strong>{title}</strong>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useApp();
  return (
    <div className="empty-state empty-state-error" role="alert">
      <span className="empty-icon">
        <WifiOff size={20} />
      </span>
      <strong>{message}</strong>
      <p>{t.genericError}</p>
      {onRetry ? (
        <button type="button" className="text-button" onClick={onRetry}>
          {t.refresh}
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Seat / player chips                                                        */
/* -------------------------------------------------------------------------- */

export function SlotCard({ label }: { label: string }) {
  return (
    <div className="seat-card is-empty" aria-hidden="true">
      <span className="empty-seat-mark">+</span>
      <span className="seat-info">
        <span className="seat-name muted">{label}</span>
      </span>
    </div>
  );
}

export function PlayersPill({ count, max }: { count: number; max: number }) {
  return (
    <span className="pill">
      <UsersRound size={13} />
      {count}/{max}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Copy / share                                                               */
/* -------------------------------------------------------------------------- */

export function CopyCodeButton({ code, label }: { code: string; label: string }) {
  const { t, buzz, setNotice, webApp } = useApp();

  async function copy() {
    const text = `${t.roomCode}: ${code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: t.create, text });
        buzz("success");
        setNotice(t.invite);
        return;
      }
    } catch {
      /* user dismissed the share sheet */
    }
    try {
      await navigator.clipboard.writeText(code);
      buzz("success");
      setNotice(t.copied);
    } catch {
      setNotice(text);
    }
    webApp?.HapticFeedback?.selectionChanged?.();
  }

  return (
    <button type="button" className="copy-code-button" onClick={() => void copy()}>
      <Copy size={15} />
      <span>{label}</span>
    </button>
  );
}

export function ShareButton({ code }: { code: string }) {
  const { t, buzz } = useApp();
  async function share() {
    const url = `${window.location.origin}/?join=${encodeURIComponent(code)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: t.create, text: `${t.roomCode}: ${code}`, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
      buzz("success");
    } catch {
      /* dismissed */
    }
  }
  return (
    <button type="button" className="ghost-button" onClick={() => void share()}>
      <Share2 size={15} />
      <span>{t.share}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Connection indicator                                                      */
/* -------------------------------------------------------------------------- */

export function ConnectionBadge({ online }: { online: boolean }) {
  const { t } = useApp();
  return (
    <span className={`connection-badge ${online ? "is-online" : "is-offline"}`}>
      {online ? <Wifi size={11} /> : <WifiOff size={11} />}
      {online ? t.online : t.connectionLost}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Toast                                                                      */
/* -------------------------------------------------------------------------- */

export function NoticeBar() {
  const { notice, setNotice } = useApp();
  const { t } = useApp();
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);
  if (!notice) return null;
  return (
    <div className="notice" role="status" aria-live="polite">
      <span>{notice}</span>
      <button type="button" aria-label={t.close} onClick={() => setNotice("")}>
        ×
      </button>
    </div>
  );
}
