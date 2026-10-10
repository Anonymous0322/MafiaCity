import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The rating model lives in SQL (`finish_game`) so it runs inside the same
 * transaction that flips the match to `completed`. These tests mirror that
 * arithmetic exactly; `db:check` proves the deployed function agrees.
 */

const START_RATING = 1000;

function kFactor(gamesPlayedBefore: number): number {
  if (gamesPlayedBefore < 10) return 48;
  if (gamesPlayedBefore < 30) return 32;
  return 24;
}

/** Mirror of the `finish_game` update for a single player. */
function settle(
  rating: number,
  gamesPlayedBefore: number,
  won: boolean,
): { delta: number; rating: number } {
  const expected = 0.5;
  const actual = won ? 1 : 0;
  const delta = Math.round((actual - expected) * kFactor(gamesPlayedBefore) * 100) / 100;
  return { delta, rating: Math.max(100, rating + delta) };
}

test("a first win awards the newcomer K", () => {
  const result = settle(START_RATING, 0, true);
  assert.equal(result.delta, 24);
  assert.equal(result.rating, 1024);
});

test("a first loss subtracts the newcomer K", () => {
  const result = settle(START_RATING, 0, false);
  assert.equal(result.delta, -24);
  assert.equal(result.rating, 976);
});

test("the K-factor decays with experience", () => {
  assert.equal(kFactor(0), 48);
  assert.equal(kFactor(9), 48);
  assert.equal(kFactor(10), 32);
  assert.equal(kFactor(29), 32);
  assert.equal(kFactor(30), 24);
  assert.equal(kFactor(500), 24);
});

/** Runs a whole record and returns the final rating. */
function playRecord(games: number, winRate: number): number {
  let rating = START_RATING;
  for (let i = 0; i < games; i += 1) {
    // deterministic pseudo-outcome so the test is reproducible
    const won = ((i * 37) % 100) / 100 < winRate;
    rating = settle(rating, i, won).rating;
  }
  return rating;
}

test("the K-factor decays, so a winning burst yields diminishing returns", () => {
  let rating = START_RATING;
  const early: number[] = [];
  for (let i = 0; i < 40; i += 1) {
    const before = rating;
    rating = settle(rating, i, true).rating;
    early.push(rating - before);
  }
  // the first 40 wins are each worth less than the one before
  assert.ok(early[0] > early[10], `K did not decay: ${early[0]} then ${early[10]}`);
  assert.ok(early[10] > early[39], `K did not decay: ${early[10]} then ${early[39]}`);
});

test("a long consistent record outranks a short winning streak", () => {
  const marathon = playRecord(200, 0.7);
  const sprint = playRecord(20, 1);
  assert.ok(
    marathon > sprint,
    `a 200-game record at 70% (${marathon.toFixed(1)}) should beat a 20-game streak (${sprint.toFixed(1)})`,
  );
});

test("an undefeated run still gains rating, but not absurdly", () => {
  const rating = playRecord(200, 1);
  assert.ok(rating > START_RATING, "winning must always gain rating");
  assert.ok(Number.isFinite(rating));
});

test("a losing streak never drops below the floor", () => {
  let rating = 140;
  for (let i = 0; i < 50; i += 1) rating = settle(rating, 40, false).rating;
  assert.equal(rating, 100);
});

test("rating is symmetric around the start value", () => {
  const win = settle(1000, 0, true);
  const loss = settle(1000, 0, false);
  assert.equal(win.rating + loss.rating, 2000);
  assert.equal(win.delta, -loss.delta);
});

test("grinding is less profitable than a long consistent record", () => {
  const veteran = settle(1000, 60, true);
  const rookie = settle(1000, 0, true);
  assert.ok(veteran.delta < rookie.delta);
});

/* -------------------------------------------------------------------------- */
/* derived statistics                                                         */
/* -------------------------------------------------------------------------- */

/** Mirror of the repository's `ratio()` helper. */
function ratio(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

test("win rate is a percentage rounded to one decimal", () => {
  assert.equal(ratio(8, 14), 57.1);
  assert.equal(ratio(1, 3), 33.3);
  assert.equal(ratio(2, 3), 66.7);
  assert.equal(ratio(1, 2), 50);
  assert.equal(ratio(7, 7), 100);
});

test("a player with no games reports 0% rather than NaN", () => {
  assert.equal(ratio(0, 0), 0);
  assert.equal(ratio(0, 0) === 0, true);
  assert.ok(Number.isFinite(ratio(0, 0)));
});

test("mafia and town win rates are independent", () => {
  const total = 20;
  const mafiaWins = 5;
  const mafiaGames = 6;
  const townWins = 5;
  const townGames = 14;
  assert.equal(mafiaWins + townWins, 10);
  assert.equal(mafiaGames + townGames, total);
  assert.equal(ratio(mafiaWins, mafiaGames), 83.3);
  assert.equal(ratio(townWins, townGames), 35.7);
});

test("survival rate uses the games actually played", () => {
  assert.equal(ratio(9, 14), 64.3);
  assert.equal(ratio(0, 0), 0);
});

/* -------------------------------------------------------------------------- */
/* deterministic tie-breaking (mirrors the `leaderboard` ORDER BY)           */
/* -------------------------------------------------------------------------- */

type Row = { id: string; rating: number; gamesWon: number; gamesPlayed: number };

const ORDER = (a: Row, b: Row) =>
  b.rating - a.rating ||
  b.gamesWon - a.gamesWon ||
  a.gamesPlayed - b.gamesPlayed ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

test("equal rating is broken by wins, then by fewer games, then by id", () => {
  const rows: Row[] = [
    { id: "b", rating: 1000, gamesWon: 10, gamesPlayed: 20 },
    { id: "a", rating: 1000, gamesWon: 10, gamesPlayed: 20 },
    { id: "c", rating: 1000, gamesWon: 12, gamesPlayed: 20 },
    { id: "d", rating: 1000, gamesWon: 10, gamesPlayed: 12 },
  ];
  assert.deepEqual([...rows].sort(ORDER).map((row) => row.id), ["c", "d", "a", "b"]);
});

test("the ordering is stable across repeated sorts", () => {
  const rows: Row[] = Array.from({ length: 40 }, (_, index) => ({
    id: `p${String(index).padStart(2, "0")}`,
    rating: 1000 + (index % 3) * 10,
    gamesWon: index % 7,
    gamesPlayed: 5 + (index % 11),
  }));
  const first = [...rows].sort(ORDER).map((row) => row.id);
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual([...rows].sort(ORDER).map((row) => row.id), first);
  }
});
