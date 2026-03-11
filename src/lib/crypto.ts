import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

// Cache the derived key at module level — scryptSync is expensive (~100ms)
let _cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret) throw new Error('TOKEN_ENCRYPTION_KEY is not set');
  _cachedKey = scryptSync(secret, 'inboxpilot-salt', 32);
  return _cachedKey;
}

export function encrypt(text: string): string {
  const key = getKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  if (!encryptedText || typeof encryptedText !== 'string') {
    throw new Error('Invalid encrypted text');
  }

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const key = getKey();
  const [ivHex, authTagHex, encrypted] = parts;

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
