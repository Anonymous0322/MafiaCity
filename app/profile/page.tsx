"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Medal, RefreshCw, Skull, Sparkles, Swords, TrendingUp, Trophy } from "lucide-react";
import { useApp } from "@/app/providers";
import {
  Avatar,
  EmptyState,
  ErrorState,
  Loader,
  NoticeBar,
  PageShell,
  SectionTitle,
  TopBar,
} from "@/components/ui";
import { interpolate, roleLabel } from "@/lib/i18n";
import type { MatchHistoryEntry, PlayerProfile, PlayerStats } from "@/lib/types";

type ProfilePayload = {
  profile: PlayerProfile;
  stats: PlayerStats;
  history: MatchHistoryEntry[];
};

export default function ProfilePage() {
  const { t, buzz, errorText } = useApp();
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/profile", { cache: "no-store" });
      const payload = (await response.json()) as ProfilePayload & { error?: string; code?: string };
      if (!response.ok || !payload.profile) {
        setError(errorText(payload.error, payload.code));
        setData(null);
        return;
      }
      setData({ profile: payload.profile, stats: payload.stats, history: payload.history ?? [] });
      setError(null);
    } catch {
      setError(errorText("network"));
    } finally {
      setLoading(false);
    }
  }, [errorText]);

  const refresh = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  return (
    <PageShell>
      <TopBar />
      <NoticeBar />
      <div className="page-body">
        <SectionTitle
          eyebrow={t.stats}
          title={t.profile}
          action={
            <button
              type="button"
              className="icon-button"
              onClick={refresh}
              aria-label={t.refresh}
            >
              <RefreshCw size={16} />
            </button>
          }
        />

        {loading && !data ? (
          <Loader label={t.loading} />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : !data ? null : (
          <ProfileContent data={data} onCheer={() => buzz("light")} />
        )}
      </div>
    </PageShell>
  );
}

function ProfileContent({ data }: { data: ProfilePayload; onCheer: () => void }) {
  const { t, language } = useApp();
  const { profile, stats, history } = data;

  return (
    <>
      <section className="profile-hero card">
        <div className="profile-hero-top">
          <Avatar name={profile.name} avatar={profile.avatar} size="large" />
          <div className="profile-identity">
            <strong title={profile.name}>{profile.name}</strong>
            {profile.username ? <span>@{profile.username}</span> : null}
            <span className="profile-rank">
              <Medal size={12} />
              {stats.rank ? `#${stats.rank}` : t.unranked}
            </span>
          </div>
        </div>
        <div className="rating-block">
          <span className="rating-value">{Math.round(stats.rating)}</span>
          <span className="rating-label">{t.rating}</span>
          <span className="rating-peak">
            <TrendingUp size={12} /> {Math.round(stats.peakRating)}
          </span>
        </div>
      </section>

      {stats.gamesPlayed === 0 ? (
        <EmptyState
          icon={<Swords size={22} />}
          title={t.noMatches}
          body={t.noStats}
          action={
            <Link className="text-button" href="/">
              {t.play}
            </Link>
          }
        />
      ) : (
        <>
          <div className="stat-grid">
            <StatTile icon={<Swords size={15} />} label={t.gamesPlayed} value={stats.gamesPlayed} />
            <StatTile icon={<Trophy size={15} />} label={t.wins} value={stats.gamesWon} tone="win" />
            <StatTile icon={<Skull size={15} />} label={t.losses} value={stats.gamesLost} tone="loss" />
            <StatTile
              icon={<Activity size={15} />}
              label={t.winRate}
              value={`${stats.winRate}%`}
              tone="accent"
            />
          </div>

          <div className="winrate-bar" role="img" aria-label={`${t.winRate} ${stats.winRate}%`}>
            <span className="winrate-fill" style={{ width: `${Math.min(100, stats.winRate)}%` }} />
          </div>

          <div className="stat-split">
            <section className="role-stat role-stat-mafia">
              <h4>
                <Skull size={14} /> {t.asMafia}
              </h4>
              <strong>
                {stats.mafiaWins}/{stats.mafiaGames}
              </strong>
              <span>{stats.mafiaWinRate}%</span>
              <div className="mini-bar">
                <span style={{ width: `${Math.min(100, stats.mafiaWinRate)}%` }} />
              </div>
            </section>
            <section className="role-stat role-stat-town">
              <h4>
                <Sparkles size={14} /> {t.asTown}
              </h4>
              <strong>
                {stats.townWins}/{stats.townGames}
              </strong>
              <span>{stats.townWinRate}%</span>
              <div className="mini-bar">
                <span style={{ width: `${Math.min(100, stats.townWinRate)}%` }} />
              </div>
            </section>
          </div>

          <section className="card survival-card">
            <h4>{t.survivalRate}</h4>
            <strong>{stats.survivalRate}%</strong>
            <span>
              {stats.survived}/{stats.gamesPlayed}
            </span>
          </section>
        </>
      )}

      <section className="players-block">
        <SectionTitle eyebrow="HISTORY" title={t.recentMatches} />
        {history.length === 0 ? (
          <EmptyState title={t.noMatches} />
        ) : (
          <div className="history-list">
            {history.map((entry) => (
              <HistoryRow key={entry.gameId} entry={entry} language={language} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone?: "win" | "loss" | "accent";
}) {
  return (
    <div className={`stat-tile${tone ? ` tone-${tone}` : ""}`}>
      <span className="stat-icon">{icon}</span>
      <strong>{value}</strong>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function HistoryRow({ entry, language }: { entry: MatchHistoryEntry; language: "uz" | "ru" | "en" }) {
  const { t } = useApp();
  const positive = entry.ratingDelta > 0;
  return (
    <article className={`history-row${entry.won ? " is-win" : " is-loss"}`}>
      <span className={`history-badge role-${entry.role}`}>{roleLabel(entry.role, t)}</span>
      <div className="history-main">
        <strong>{entry.won ? t.won : t.lost}</strong>
        <span>
          {entry.winner === "mafia" ? t.mafia : t.town} · {interpolate(t.rounds, { n: entry.rounds })} ·{" "}
          {interpolate(t.playersCount, { n: entry.playerCount })}
        </span>
      </div>
      <span className={`history-delta ${positive ? "is-up" : "is-down"}`}>
        {positive ? "+" : ""}
        {entry.ratingDelta}
      </span>
      <time className="history-date" dateTime={entry.playedAt} suppressHydrationWarning>
        {new Date(entry.playedAt).toLocaleDateString(language, {
          day: "2-digit",
          month: "2-digit",
        })}
      </time>
    </article>
  );
}
