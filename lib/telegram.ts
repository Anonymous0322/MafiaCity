import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramUserPayload = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
};

export type TelegramAuthData = {
  user: TelegramUserPayload;
  authDate: number;
  startParam?: string;
  queryId?: string;
};

export function parseTelegramInitData(initData: string): Record<string, string> | null {
  const result: Record<string, string> = {};
  const params = new URLSearchParams(initData);
  for (const [key, value] of params) {
    if (Object.hasOwn(result, key)) return null;
    result[key] = value;
  }
  return result;
}

/**
 * Official Telegram Mini App validation (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 *   secret_key = HMAC_SHA256(key: "WebAppData", msg: bot_token)
 *   hash       = HMAC_SHA256(key: secret_key,   msg: data_check_string)
 * The data check string is every field except `hash`, sorted by key.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  now = Date.now(),
): boolean {
  if (!initData || !botToken) return false;
  const params = parseTelegramInitData(initData);
  const hash = params?.hash;
  const authDate = Number(params?.auth_date);
  if (!params || !hash || !/^[a-f\d]{64}$/i.test(hash) || !Number.isInteger(authDate)) {
    return false;
  }

  const ageSeconds = Math.floor(now / 1000) - authDate;
  // reject wildly future-dated and stale payloads
  if (ageSeconds < -30 || ageSeconds > 60 * 60 * 24) return false;

  const dataCheckString = Object.entries(params)
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const supplied = Buffer.from(hash, "hex");
  return supplied.length === expected.length && timingSafeEqual(expected, supplied);
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // strip control characters (they break Postgres text + UI layout) then clamp
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

/**
 * Full server-side authentication. The hash is verified against the bot token
 * FIRST; only then is the embedded user JSON parsed and shape-checked. The
 * resulting identity is the only source of truth for the request — client
 * supplied ids and names are never trusted.
 */
export function authenticateTelegramInitData(
  initData: string,
  botToken: string,
  now = Date.now(),
): { ok: true; data: TelegramAuthData } | { ok: false; reason: "invalid" | "malformed" } {
  if (!verifyTelegramInitData(initData, botToken, now)) return { ok: false, reason: "invalid" };
  const params = parseTelegramInitData(initData)!;
  if (!params.user) return { ok: false, reason: "malformed" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(params.user);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "malformed" };
  const raw = parsed as Record<string, unknown>;

  const id = Number(raw.id);
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: "malformed" };
  const firstName = cleanText(raw.first_name, 64);
  if (!firstName) return { ok: false, reason: "malformed" };

  const username = cleanText(raw.username, 64).replace(/^@/, "");
  const language = cleanText(raw.language_code, 8).slice(0, 2).toLowerCase();

  return {
    ok: true,
    data: {
      user: {
        id,
        first_name: firstName,
        last_name: cleanText(raw.last_name, 64) || undefined,
        username: username || undefined,
        photo_url: cleanText(raw.photo_url, 512) || undefined,
        language_code: language || undefined,
      },
      authDate: Number(params.auth_date),
      startParam: cleanText(params.start_param, 128) || undefined,
      queryId: cleanText(params.query_id, 128) || undefined,
    },
  };
}

/**
 * Display name resolution.
 *
 * The nickname (first + last name) is the primary label: that is what a person
 * calls themselves. The `@username` is kept separately as a handle and shown
 * as secondary text, and is only used as a last-resort label when Telegram
 * gives no name at all.
 */
export function resolveDisplayName(user: TelegramUserPayload): string {
  return resolveNickname(user) || user.username || "Telegram player";
}

/** The nickname alone, or "" when Telegram gave us no name at all. */
export function resolveNickname(user: TelegramUserPayload): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
}
