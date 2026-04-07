import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { deriveMachineKey, derivePassphraseKey } from "../src/encryption/key.js";
import { encrypt, decrypt } from "../src/encryption/crypto.js";

// ─── 1. Key derivation ───────────────────────────────────────────────────────

describe("Key derivation", () => {
  it("deriveMachineKey() returns a 32-byte Buffer", () => {
    const key = deriveMachineKey();
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it("deriveMachineKey() is deterministic (consistent across calls)", () => {
    const k1 = deriveMachineKey();
    const k2 = deriveMachineKey();
    expect(k1.equals(k2)).toBe(true);
  });

  it("derivePassphraseKey() returns a 32-byte Buffer", () => {
    const key = derivePassphraseKey("test-passphrase");
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it("derivePassphraseKey() is deterministic for the same passphrase", () => {
    const k1 = derivePassphraseKey("my-secret");
    const k2 = derivePassphraseKey("my-secret");
    expect(k1.equals(k2)).toBe(true);
  });

  it("different passphrases produce different keys", () => {
    const k1 = derivePassphraseKey("alpha");
    const k2 = derivePassphraseKey("beta");
    expect(k1.equals(k2)).toBe(false);
  });

  it("machine key and passphrase key are different", () => {
    const machineKey = deriveMachineKey();
    const passphraseKey = derivePassphraseKey("any-passphrase");
    expect(machineKey.equals(passphraseKey)).toBe(false);
  });
});

// ─── 2. Encrypt/decrypt roundtrip ────────────────────────────────────────────

describe("Encrypt/decrypt roundtrip", () => {
  const key = derivePassphraseKey("roundtrip-test");

  it("small data roundtrip", () => {
    const plaintext = Buffer.from("hello world");
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("empty data roundtrip", () => {
    const plaintext = Buffer.alloc(0);
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);
    expect(decrypted.length).toBe(0);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("large data roundtrip (1 MB)", () => {
    const plaintext = randomBytes(1024 * 1024);
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("binary data roundtrip (random bytes)", () => {
    const plaintext = randomBytes(256);
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);
    expect(decrypted.equals(plaintext)).toBe(true);
  });
});

// ─── 3. Encryption properties ────────────────────────────────────────────────

describe("Encryption properties", () => {
  const key = derivePassphraseKey("properties-test");

  it("same plaintext produces different ciphertext (random IV)", () => {
    const plaintext = Buffer.from("deterministic?");
    const enc1 = encrypt(plaintext, key);
    const enc2 = encrypt(plaintext, key);
    expect(enc1.equals(enc2)).toBe(false);
  });

  it("encrypted data starts with 'SNCT' magic bytes", () => {
    const encrypted = encrypt(Buffer.from("magic check"), key);
    expect(encrypted.subarray(0, 4).toString()).toBe("SNCT");
  });

  it("encrypted data is larger than plaintext (IV + tag overhead)", () => {
    const plaintext = Buffer.from("size check");
    const encrypted = encrypt(plaintext, key);
    expect(encrypted.length).toBeGreaterThan(plaintext.length);
  });

  it("minimum overhead = 4 (magic) + 12 (IV) + 16 (tag) = 32 bytes", () => {
    const plaintext = Buffer.from("overhead");
    const encrypted = encrypt(plaintext, key);
    const overhead = encrypted.length - plaintext.length;
    expect(overhead).toBe(32);
  });

  it("overhead is exactly 32 bytes for empty plaintext too", () => {
    const plaintext = Buffer.alloc(0);
    const encrypted = encrypt(plaintext, key);
    expect(encrypted.length).toBe(32);
  });
});

// ─── 4. Decryption failure modes ─────────────────────────────────────────────

describe("Decryption failure modes", () => {
  const key = derivePassphraseKey("failure-test");
  const wrongKey = derivePassphraseKey("wrong-key");
  const validEncrypted = encrypt(Buffer.from("secret data"), key);

  it("wrong key throws", () => {
    expect(() => decrypt(validEncrypted, wrongKey)).toThrow();
  });

  it("truncated data throws", () => {
    const truncated = validEncrypted.subarray(0, 20);
    expect(() => decrypt(truncated, key)).toThrow();
  });

  it("corrupted ciphertext throws", () => {
    const corrupted = Buffer.from(validEncrypted);
    // Flip a byte in the ciphertext region (after magic + IV = offset 16)
    corrupted[20] ^= 0xff;
    expect(() => decrypt(corrupted, key)).toThrow();
  });

  it("wrong magic bytes throws", () => {
    const wrongMagic = Buffer.from(validEncrypted);
    wrongMagic[0] = 0x00;
    wrongMagic[1] = 0x00;
    wrongMagic[2] = 0x00;
    wrongMagic[3] = 0x00;
    expect(() => decrypt(wrongMagic, key)).toThrow(/magic bytes/);
  });

  it("empty buffer throws", () => {
    expect(() => decrypt(Buffer.alloc(0), key)).toThrow();
  });

  it("modified auth tag throws (tamper detection)", () => {
    const tampered = Buffer.from(validEncrypted);
    // Auth tag is the last 16 bytes
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it("buffer shorter than minimum overhead throws", () => {
    const tooShort = Buffer.from("SNCT" + "x".repeat(10));
    expect(() => decrypt(tooShort, key)).toThrow(/too short/);
  });
});

// ─── 5. DB encryption integration ───────────────────────────────────────────

describe("DB encryption integration", () => {
  const dbPath = join(homedir(), ".sincenety", "sincenety.db");

  it("~/.sincenety/sincenety.db exists", () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it("DB file starts with 'SNCT' magic bytes", () => {
    const data = readFileSync(dbPath);
    expect(data.subarray(0, 4).toString()).toBe("SNCT");
  });

  it("DB file cannot be opened as raw SQLite (no SQLite header)", () => {
    const data = readFileSync(dbPath);
    const header = data.subarray(0, 16).toString();
    expect(header).not.toContain("SQLite format 3");
  });

  it("decrypted with machine key yields valid SQLite header", () => {
    const encryptedData = readFileSync(dbPath);
    const machineKey = deriveMachineKey();
    const decrypted = decrypt(encryptedData, machineKey);
    const sqliteHeader = decrypted.subarray(0, 15).toString();
    expect(sqliteHeader).toBe("SQLite format 3");
  });
});
