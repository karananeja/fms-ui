import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * F25 (D-143): AES-256-GCM for user AI keys at rest. The 32-byte key is HKDF-SHA256 of
 * `FMS_SECRET_KEY` (≥ 16 chars, read per call so tests can switch it); without it nothing is
 * stored. Ciphertext format: `v1:` + base64(iv[12] ‖ tag[16] ‖ ciphertext). The AAD binds a row
 * to its user and provider.
 */

export const SECRET_ENV = 'FMS_SECRET_KEY';
export const MIN_SECRET_LENGTH = 16;
const VERSION = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The derived encryption key, or `undefined` when `FMS_SECRET_KEY` is unset or too short. */
export function secretKey(env: NodeJS.ProcessEnv = process.env): Buffer | undefined {
  const secret = env[SECRET_ENV]?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return undefined;
  return Buffer.from(hkdfSync('sha256', secret, 'fms-ai-keys', 'aes-256-gcm v1', 32));
}

export const keyAad = (userId: string, provider: string) => `${userId}:${provider}`;

export function encryptSecret(plain: string, aad: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return VERSION + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/** The plaintext, or `undefined` if the blob, AAD or key does not match. */
export function decryptSecret(blob: string, aad: string, key: Buffer | undefined): string | undefined {
  if (!key || !blob.startsWith(VERSION)) return undefined;
  try {
    const raw = Buffer.from(blob.slice(VERSION.length), 'base64');
    if (raw.length <= IV_BYTES + TAG_BYTES) return undefined;
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return undefined;
  }
}

/** `xai-…9f3c`, `sk-ant-…ab12`, `sk-…wxyz`: the known prefix plus the last 4 characters. */
export function maskKey(key: string): string {
  const prefix = /^(sk-ant-|[a-z]{2,8}-)/i.exec(key)?.[0] ?? '';
  return `${prefix}…${key.slice(-4)}`;
}

const TOKEN_PATTERN = /\b(?:sk-ant-|sk-|xai-|fake-)[A-Za-z0-9_*.-]{4,}/g;

/** Removes the given keys and anything shaped like a provider key from text (logs, errors). */
export function redactSecrets(text: string, ...keys: (string | undefined)[]): string {
  let out = text;
  for (const k of keys) if (k && k.length >= 4) out = out.split(k).join('[redacted]');
  return out.replace(TOKEN_PATTERN, '[redacted]');
}
