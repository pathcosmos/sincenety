import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";

export interface HistoryEntry {
  display: string;
  pastedContents: Record<string, unknown>;
  timestamp: number;
  project: string;
  sessionId: string;
}

export function getDefaultHistoryPath(): string {
  return join(homedir(), ".claude", "history.jsonl");
}

export async function* parseHistory(options: {
  historyPath?: string;
  sinceTimestamp?: number;
} = {}): AsyncGenerator<HistoryEntry> {
  const filePath = options.historyPath ?? getDefaultHistoryPath();
  const since = options.sinceTimestamp ?? 0;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry: HistoryEntry = JSON.parse(line);
      if (entry.timestamp > since) {
        yield entry;
      }
    } catch {
      // skip malformed lines
    }
  }
}
