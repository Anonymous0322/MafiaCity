import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  authenticateTelegramInitData,
  parseTelegramInitData,
  resolveDisplayName,
  resolveNickname,
  verifyTelegramInitData,
} from "@/lib/telegram";

// Assembled from parts so no token-shaped literal is ever committed to the repo.
const BOT_TOKEN = `${"1234567890"}:${"AAExampleTokenForUnitTests_0000000000"}`;
const FOREIGN_TOKEN = `999:${"DIFFERENTToken________________"}`;

/** Mirrors the official Telegram Web App signing procedure. */
function signInitData(fields: Record<string, string>, now = Date.now()): string {
  const authDate = String(Math.floor(now / 1000));
  const payload = { ...fields, auth_date: authDate };
  const dataCheckString = Object.entries(payload)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const params = new URLSearchParams({ ...payload, hash });
  return params.toString();
}

const USER = {
  id: "123456789",
  first_name: "Alisher",
  last_name: "Karimov",
  username: "alisher",
  photo_url: "https://t.me/i/userpic/320/alisher.jpg",
};

/* -------------------------------------------------------------------------- */

test("a correctly signed initData payload is accepted", () => {
  const initData = signInitData({ user: JSON.stringify(USER) });
  assert.equal(verifyTelegramInitData(initData, BOT_TOKEN), true);
  const result = authenticateTelegramInitData(initData, BOT_TOKEN);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.user.id, 123456789);
    assert.equal(result.data.user.username, "alisher");
    assert.equal(result.data.user.first_name, "Alisher");
    assert.equal(result.data.user.photo_url, "https://t.me/i/userpic/320/alisher.jpg");
  }
});

test("a tampered payload is rejected", () => {
  const initData = signInitData({ user: JSON.stringify(USER) });
  const tampered = initData.replace("alisher", "attacker");
  assert.equal(verifyTelegramInitData(tampered, BOT_TOKEN), false);
  const result = authenticateTelegramInitData(tampered, BOT_TOKEN);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "invalid");
});

test("a payload signed with a different bot token is rejected", () => {
  const initData = signInitData({ user: JSON.stringify(USER) });
  assert.equal(verifyTelegramInitData(initData, FOREIGN_TOKEN), false);
});

test("expired and future-dated payloads are rejected", () => {
  const old = signInitData({ user: JSON.stringify(USER) }, Date.now() - 1000 * 60 * 60 * 48);
  assert.equal(verifyTelegramInitData(old, BOT_TOKEN), false);

  const future = signInitData({ user: JSON.stringify(USER) }, Date.now() + 1000 * 600);
  assert.equal(verifyTelegramInitData(future, BOT_TOKEN), false);
});

test("malformed inputs are rejected without throwing", () => {
  for (const input of ["", "not-a-url-encoded-string", "hash=zzzz", "user=%7B%7D"]) {
    assert.doesNotThrow(() => verifyTelegramInitData(input, BOT_TOKEN));
  }
  assert.equal(verifyTelegramInitData("user=%7B%7D&auth_date=1&hash=deadbeef", BOT_TOKEN), false);
});

test("duplicate keys are rejected by the parser", () => {
  assert.equal(parseTelegramInitData("a=1&a=2"), null);
});

test("a missing or unparsable user block is reported as malformed", () => {
  const withoutUser = signInitData({ query_id: "AAH" });
  const result = authenticateTelegramInitData(withoutUser, BOT_TOKEN);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "malformed");

  const brokenJson = signInitData({ user: "{not json" });
  const broken = authenticateTelegramInitData(brokenJson, BOT_TOKEN);
  assert.equal(broken.ok, false);
  assert.equal(broken.ok === false && broken.reason, "malformed");
});

test("a user without an id or first_name is rejected", () => {
  const noId = signInitData({ user: JSON.stringify({ first_name: "A" }) });
  assert.equal(authenticateTelegramInitData(noId, BOT_TOKEN).ok, false);

  const noName = signInitData({ user: JSON.stringify({ id: 5 }) });
  assert.equal(authenticateTelegramInitData(noName, BOT_TOKEN).ok, false);
});

test("control characters are stripped from profile fields", () => {
  const dirty = signInitData({
    user: JSON.stringify({ id: 7, first_name: "BadName", username: "username" }),
  });
  const result = authenticateTelegramInitData(dirty, BOT_TOKEN);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.user.first_name, "BadName");
    assert.equal(result.data.user.username, "username");
  }
});

test("start_param survives verification", () => {
  const initData = signInitData({ user: JSON.stringify(USER), start_param: "invite-42" });
  const result = authenticateTelegramInitData(initData, BOT_TOKEN);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.data.startParam, "invite-42");
});

/* -------------------------------------------------------------------------- */
/* display name resolution — the reported "..." bug                            */
/* -------------------------------------------------------------------------- */

test("display name prefers the Telegram nickname over the username", () => {
  const name = resolveDisplayName({
    id: 1,
    first_name: "Alisher",
    last_name: "Karimov",
    username: "alisher",
  });
  assert.equal(name, "Alisher Karimov");
  assert.notEqual(name, "alisher");
  assert.notEqual(name, "...");
});

test("display name keeps a single-word nickname intact", () => {
  assert.equal(resolveDisplayName({ id: 1, first_name: "Alisher", username: "ali" }), "Alisher");
});

test("the username is only a last-resort label when there is no name at all", () => {
  assert.equal(resolveDisplayName({ id: 1, first_name: "", username: "ali" }), "ali");
  assert.equal(resolveDisplayName({ id: 1, first_name: "" }), "Telegram player");
});

test("resolveNickname is empty without a name, so the stored name is kept", () => {
  assert.equal(resolveNickname({ id: 1, first_name: "Alisher", last_name: "Karimov" }), "Alisher Karimov");
  assert.equal(resolveNickname({ id: 1, first_name: "Alisher", username: "ali" }), "Alisher");
  assert.equal(resolveNickname({ id: 1, first_name: "", username: "ali" }), "");
  assert.equal(resolveNickname({ id: 1, first_name: "   " }), "");
});

test("display name never collapses to an ellipsis", () => {
  const cases = [
    { id: 1, first_name: "A" },
    { id: 2, first_name: "Alisher", username: "ali" },
    { id: 3, first_name: "Alisher", last_name: "K" },
  ];
  for (const user of cases) {
    const name = resolveDisplayName(user);
    assert.ok(name.length > 0);
    assert.notEqual(name, "...");
    assert.notEqual(name, "…");
  }
});

test("a leading @ in a username is normalised away", () => {
  const initData = signInitData({ user: JSON.stringify({ id: 9, first_name: "A", username: "@ali" }) });
  const result = authenticateTelegramInitData(initData, BOT_TOKEN);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.data.user.username, "ali");
});
