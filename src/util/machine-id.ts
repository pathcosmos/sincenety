import { platform, hostname } from "node:os";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

/**
 * Generate a stable machine ID from hardware UUID + username.
 * Same machine + same user = always same ID, even after app reinstall.
 *
 * NOTE: execSync is used intentionally here with hardcoded commands only
 * (no user input) to read platform-specific hardware identifiers.
 */
export function getMachineId(): string {
  const os = platform();
  const user = process.env.USER ?? process.env.USERNAME ?? "unknown";
  let hwId = "unknown";

  try {
    if (os === "darwin") {
      const raw = execSync("ioreg -rd1 -c IOPlatformExpertDevice", { encoding: "utf8" });
      hwId = raw.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] ?? "unknown";
    } else if (os === "linux") {
      if (existsSync("/etc/machine-id")) {
        hwId = readFileSync("/etc/machine-id", "utf8").trim();
      } else if (existsSync("/var/lib/dbus/machine-id")) {
        hwId = readFileSync("/var/lib/dbus/machine-id", "utf8").trim();
      }
    } else if (os === "win32") {
      const raw = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: "utf8" });
      hwId = raw.match(/MachineGuid\s+REG_SZ\s+(.+)/)?.[1]?.trim() ?? "unknown";
    }
  } catch {
    // Fallback: use hostname if hardware ID unavailable
    hwId = hostname();
  }

  if (hwId === "unknown") {
    hwId = hostname();
  }

  const prefix = os === "darwin" ? "mac" : os === "linux" ? "linux" : os === "win32" ? "win" : "other";
  const hash = createHash("sha256").update(`${os}:${hwId}:${user}`).digest("hex").slice(0, 8);

  return `${prefix}_${hash}_${user}`;
}
