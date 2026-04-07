import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const MAGIC = Buffer.from("SNCT");
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = "aes-256-gcm";

/**
 * Encrypt data using AES-256-GCM.
 *
 * Returns a Buffer: [4-byte magic "SNCT"][12-byte IV][ciphertext][16-byte authTag]
 */
export function encrypt(data: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([MAGIC, iv, ciphertext, authTag]);
}

/**
 * Decrypt data previously encrypted with `encrypt`.
 *
 * Validates magic bytes, extracts IV / ciphertext / authTag, and returns
 * the decrypted Buffer.
 */
export function decrypt(encrypted: Buffer, key: Buffer): Buffer {
  if (encrypted.length < MAGIC.length + IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted data is too short to be valid");
  }

  const magic = encrypted.subarray(0, MAGIC.length);
  if (!magic.equals(MAGIC)) {
    throw new Error("Invalid magic bytes — data was not encrypted by sincenety");
  }

  const iv = encrypted.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
  const authTag = encrypted.subarray(encrypted.length - AUTH_TAG_LENGTH);
  const ciphertext = encrypted.subarray(MAGIC.length + IV_LENGTH, encrypted.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Decryption failed — wrong key or corrupted data");
  }
}
