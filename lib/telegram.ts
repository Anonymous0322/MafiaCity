import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function parseTelegramInitData(initData: string): Record<string, string> | null {
  const result: Record<string, string> = {};
  const params = new URLSearchParams(initData);
  for (const [key, value] of params) {
    if (Object.hasOwn(result, key)) return null;
    result[key] = value;
  }
  return result;
}

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
