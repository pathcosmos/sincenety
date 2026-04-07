import { pbkdf2Sync, randomBytes } from "node:crypto";
import { hostname, userInfo, homedir } from "node:os";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";
const SALT_LENGTH = 32;

function getSaltPath(): string {
  return join(homedir(), ".sincenety", "sincenety.salt");
}

/**
 * Read or create a per-installation random salt.
 * Stored at ~/.sincenety/sincenety.salt (mode 0600).
 */
function getOrCreateSalt(): Buffer {
  const saltPath = getSaltPath();
  if (existsSync(saltPath)) {
    return readFileSync(saltPath);
  }
  const dir = join(homedir(), ".sincenety");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const salt = randomBytes(SALT_LENGTH);
  writeFileSync(saltPath, salt, { mode: 0o600 });
  return salt;
}

/**
 * Derive a machine-bound encryption key from hostname + username + random salt.
 */
export function deriveMachineKey(): Buffer {
  const identity = `${hostname()}::${userInfo().username}`;
  const salt = getOrCreateSalt();
  return pbkdf2Sync(identity, salt, ITERATIONS, KEY_LENGTH, DIGEST);
}

/**
 * Derive an encryption key from a user-supplied passphrase + random salt.
 */
export function derivePassphraseKey(passphrase: string): Buffer {
  const salt = getOrCreateSalt();
  return pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LENGTH, DIGEST);
}
