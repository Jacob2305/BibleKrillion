/**
 * Tiny sealed tokens so the serverless functions can stay stateless: the server
 * seals "prompt X, ends at D" and later trusts only tokens it sealed.
 *
 * Tokens are encrypted AND authenticated (AES-256-GCM), so players can neither
 * forge them nor read them, e.g. to peek at which prompts are coming up next.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { isDeployed } from "./config.js";

const DEV_SECRET = "bible-dive-local-dev-secret";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * SESSION_SECRET if set; otherwise derived from SUPABASE_SERVICE_ROLE_KEY (also
 * server-only). Local dev falls back to a fixed secret. A real deployment with
 * neither set refuses to run rather than accept forgeable tokens.
 */
export function getSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return `bible-dive-session:${process.env.SUPABASE_SERVICE_ROLE_KEY}`;
  if (isDeployed()) {
    throw new Error("Set SESSION_SECRET (or SUPABASE_SERVICE_ROLE_KEY) in the Vercel environment variables.");
  }
  return DEV_SECRET;
}

const keyCache = new Map<string, Buffer>();
function keyFor(secret: string): Buffer {
  let key = keyCache.get(secret);
  if (!key) keyCache.set(secret, (key = createHash("sha256").update(secret).digest()));
  return key;
}

export function signToken(payload: object, secret: string = getSecret()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

/** Returns the payload if the token was sealed with this secret and not altered, else null. */
export function verifyToken<T>(token: unknown, secret: string = getSecret()): T | null {
  if (typeof token !== "string" || token.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const raw = Buffer.from(token, "base64url");
  if (raw.length <= IV_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    const text = Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString("utf8");
    const payload: unknown = JSON.parse(text);
    return typeof payload === "object" && payload !== null ? (payload as T) : null;
  } catch {
    return null;
  }
}
