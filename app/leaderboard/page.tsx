"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Crown, Medal, RefreshCw, Trophy } from "lucide-react";
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
import { interpolate } from "@/lib/i18n";
import type { LeaderboardView } from "@/lib/types";

const PODIUM_ORDER = [2, 1, 3];

export default function LeaderboardPage() {
  const { t, buzz, errorText } = useApp();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LeaderboardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (target: number) => {
      try {
        const response = await fetch(`/api/leaderboard?page=${target}`, { cache: "no-store" });
        const payload = (await response.json()) as LeaderboardView & { error?: string; code?: string };
        if (!response.ok) {
          setError(errorText(payload.error, payload.code));
          setData(null);
          return;
        }
        setData(payload);
        setError(null);
      } catch {
        setError(errorText("network"));
      } finally {
        setLoading(false);
      }
    },
    [errorText],
  );

  const refresh = useCallback(() => {
    setLoading(true);
    void load(page);
  }, [load, page]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(page), 0);
    return () => window.clearTimeout(kickoff);
  }, [load, page]);

  const players = data?.players ?? [];
  const podium = page === 1 ? players.filter((row) => row.rank <= 3) : [];

  return (
    <PageShell>
      <TopBar />
      <NoticeBar />
      <div className="page-body">
        <SectionTitle
          eyebrow="RANKING"
          title={t.leaderboard}
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
        ) : players.length === 0 ? (
          <EmptyState icon={<Trophy size={22} />} title={t.leaderboardEmpty} body={t.noStats} />
        ) : (
          <>
            {podium.length > 0 ? (
              <section className="podium">
                {PODIUM_ORDER.map((rank) => {
                  const row = podium.find((entry) => entry.rank === rank);
                  if (!row) return <div key={rank} className="podium-slot" />;
                  return (
                    <div className={`podium-slot rank-${rank}`} key={rank}>
                      <span className="podium-crown">
                        {rank === 1 ? <Crown size={18} /> : <Medal size={16} />}
                      </span>
                      <span className="podium-rank">#{rank}</span>
                      <Avatar name={row.displayName} avatar={row.photoUrl} size="large" />
                      <strong title={row.displayName}>{row.displayName}</strong>
                      <span className="podium-rating">{Math.round(row.rating)}</span>
                      <span className="podium-meta">
                        {row.gamesWon}/{row.gamesPlayed} · {row.winRate}%
                      </span>
                    </div>
                  );
                })}
              </section>
            ) : null}

            <div className="leaderboard-list">
              {players.map((row) => (
                <article
                  key={row.id}
                  className={`leader-row${row.isMe ? " is-me" : ""}${row.rank <= 3 ? ` is-top rank-${row.rank}` : ""}`}
                >
                  <span className="leader-rank">{row.rank}</span>
                  <Avatar name={row.displayName} avatar={row.photoUrl} />
                  <div className="leader-identity">
                    <strong title={row.displayName}>
                      {row.displayName}
                      {row.isMe ? <em className="leader-you">{t.me}</em> : null}
                    </strong>
                    <span>
                      {row.gamesWon}/{row.gamesPlayed} · {row.winRate}%
                    </span>
                  </div>
                  <span className="leader-rating">{Math.round(row.rating)}</span>
                </article>
              ))}
            </div>

            <div className="pagination">
              <button
                type="button"
                className="ghost-button"
                disabled={page <= 1 || loading}
                onClick={() => {
                  buzz("select");
                  setPage((value) => Math.max(1, value - 1));
                }}
              >
                <ChevronLeft size={15} /> {t.prev}
              </button>
              <span>{interpolate(t.page, { n: page })}</span>
              <button
                type="button"
                className="ghost-button"
                disabled={loading || players.length < (data?.pageSize ?? 25)}
                onClick={() => {
                  buzz("select");
                  setPage((value) => value + 1);
                }}
              >
                {t.next} <ChevronRight size={15} />
              </button>
            </div>

            {data?.me && !data.me.displayName && data.me.rank > 0 ? (
              <div className="my-rank-card">
                <span className="leader-rank">{data.me.rank}</span>
                <Avatar name={t.me} />
                <div className="leader-identity">
                  <strong>{t.me}</strong>
                  <span>
                    {data.me.gamesWon}/{data.me.gamesPlayed} · {data.me.winRate}%
                  </span>
                </div>
                <span className="leader-rating">{Math.round(data.me.rating)}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </PageShell>
  );
}
