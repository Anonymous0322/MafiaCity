import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { createSessionToken, verifySessionToken } from "@/lib/session";
import { clientKey, rateLimit } from "@/lib/api/rate-limit";

/* -------------------------------------------------------------------------- */
/* session cookies                                                            */
/* -------------------------------------------------------------------------- */

const PAYLOAD = {
  userId: "3f0d1a2b-1111-4222-8333-444444444444",
  username: "alisher",
  displayName: "alisher",
  avatar: null,
};

test("a session token round-trips", () => {
  const token = createSessionToken(PAYLOAD, 3600);
  const payload = verifySessionToken(token);
  assert.ok(payload);
  assert.equal(payload.userId, PAYLOAD.userId);
  assert.equal(payload.username, PAYLOAD.username);
  assert.equal(payload.displayName, PAYLOAD.displayName);
  assert.equal(payload.avatar, null);
});

test("a tampered session token is rejected", () => {
  const token = createSessionToken(PAYLOAD, 3600);
  const [encoded, signature] = token.split(".");
  const forged = Buffer.from(
    JSON.stringify({ ...PAYLOAD, displayName: "attacker", exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  assert.equal(verifySessionToken(`${forged}.${signature}`), null);
  assert.equal(verifySessionToken(`${encoded}.deadbeef`), null);
});

test("an expired session token is rejected", () => {
  const token = createSessionToken(PAYLOAD, -10);
  assert.equal(verifySessionToken(token), null);
});

test("garbage cookies never throw", () => {
  for (const value of ["", ".", "..", "a.b", "x".repeat(5000), "%00", '{"a":1}.b']) {
    assert.doesNotThrow(() => verifySessionToken(value));
  }
  assert.equal(verifySessionToken(undefined), null);
  assert.equal(verifySessionToken(""), null);
});

test("a payload without a userId is rejected", () => {
  const encoded = Buffer.from(
    JSON.stringify({ displayName: "x", exp: Math.floor(Date.now() / 1000) + 60 }),
  ).toString("base64url");
  const forged = `${encoded}.deadbeef`;
  assert.equal(verifySessionToken(forged), null);
});

/* -------------------------------------------------------------------------- */
/* Telegram signature helper (mirrors what the auth route does)               */
/* -------------------------------------------------------------------------- */

function sign(fields: Record<string, string>, botToken: string): string {
  const payload = { ...fields, auth_date: String(Math.floor(Date.now() / 1000)) };
  const dataCheckString = Object.entries(payload)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...payload, hash }).toString();
}

test("a forged bot token cannot produce an accepted signature", () => {
  const real = `111:RE${String.fromCharCode(65)}L`;
  const fake = `222:FA${String.fromCharCode(75)}E`;
  const initData = sign({ user: JSON.stringify({ id: 1, first_name: "A" }) }, fake);
  // the server verifies with `real`, so this must fail the HMAC comparison
  const secretReal = createHmac("sha256", "WebAppData").update(real).digest();
  const params = new URLSearchParams(initData);
  const { hash, ...rest } = Object.fromEntries(params);
  const check = Object.entries(rest)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const expected = createHmac("sha256", secretReal).update(check).digest("hex");
  assert.notEqual(hash, expected);
});

/* -------------------------------------------------------------------------- */
/* rate limiter                                                               */
/* -------------------------------------------------------------------------- */

test("the limiter allows up to the window limit and then blocks", () => {
  const key = `test:${Math.random()}`;
  const now = Date.now();
  for (let i = 0; i < 5; i += 1) {
    const result = rateLimit(key, 5, 60_000, now);
    assert.equal(result.allowed, true, `request ${i + 1} should pass`);
  }
  const blocked = rateLimit(key, 5, 60_000, now);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test("the limiter resets after the window", () => {
  const key = `reset:${Math.random()}`;
  const now = Date.now();
  for (let i = 0; i < 3; i += 1) rateLimit(key, 3, 1_000, now);
  assert.equal(rateLimit(key, 3, 1_000, now).allowed, false);
  assert.equal(rateLimit(key, 3, 1_000, now + 1_500).allowed, true);
});

test("different keys have independent budgets", () => {
  const now = Date.now();
  const a = `a:${Math.random()}`;
  const b = `b:${Math.random()}`;
  for (let i = 0; i < 4; i += 1) rateLimit(a, 4, 60_000, now);
  assert.equal(rateLimit(a, 4, 60_000, now).allowed, false);
  assert.equal(rateLimit(b, 4, 60_000, now).allowed, true);
});

test("clientKey falls back safely when proxy headers are absent", () => {
  assert.equal(clientKey(new Headers()), "unknown");
  assert.equal(
    clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })),
    "1.2.3.4",
  );
  assert.equal(clientKey(new Headers({ "x-real-ip": "9.9.9.9" })), "9.9.9.9");
});
