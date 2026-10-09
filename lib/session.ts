import { createHmac, timingSafeEqual } from "node:crypto";

export type SessionPayload = {
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  exp: number;
};

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "local-development-only-session-secret";
  throw new Error("SESSION_SECRET must be configured.");
}

function sign(encoded: string) {
  return createHmac("sha256", getSecret()).update(encoded).digest();
}

export function createSessionToken(
  data: Omit<SessionPayload, "exp">,
  expiresInSeconds = 60 * 60 * 24,
) {
  const payload: SessionPayload = { ...data, exp: Math.floor(Date.now() / 1000) + expiresInSeconds };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded).toString("base64url")}`;
}

export function verifySessionToken(token?: string): SessionPayload | null {
  if (!token || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const [encoded, signature] = parts;
    const expected = sign(encoded);
    const supplied = Buffer.from(signature, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return null;
    const payload: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (
      !payload ||
      typeof payload !== "object" ||
      !("userId" in payload) ||
      typeof payload.userId !== "string" ||
      !("exp" in payload) ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      username: "username" in payload && typeof payload.username === "string" ? payload.username : "",
      displayName:
        "displayName" in payload && typeof payload.displayName === "string"
          ? payload.displayName
          : "Telegram player",
      avatar: "avatar" in payload && typeof payload.avatar === "string" ? payload.avatar : null,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}
