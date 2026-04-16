/**
 * #3 sincenety doctor — 최근 N일의 요약 누락/비어있음/stale 상태 진단.
 */

import type { StorageAdapter } from "../storage/adapter.js";
import { padEndW } from "../util/display-width.js";

export interface DoctorRow {
  date: string;
  hasGather: boolean;
  hasDaily: boolean;
  emailed: boolean;
  stale: boolean;
  emptySummary: boolean;
  status: "OK" | "MISSING_SUMMARY" | "EMPTY_SUMMARY" | "STALE" | "NO_DATA";
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 최근 `days`일 진단 (today 포함, 기본 14) */
export async function runDoctor(
  storage: StorageAdapter,
  days = 14,
  today?: Date,
): Promise<DoctorRow[]> {
  const rows: DoctorRow[] = [];
  const now = today ?? new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const dateStr = toDateStr(d);
    const f = await storage.getDailyReportFreshness(dateStr, "daily");
    let emptySummary = false;
    if (f?.hasDailyReport) {
      const report = await storage.getDailyReport(dateStr, "daily");
      try {
        const parsed = JSON.parse(report?.summaryJson ?? "[]");
        emptySummary = !Array.isArray(parsed) || parsed.length === 0;
      } catch {
        emptySummary = true;
      }
    }
    let status: DoctorRow["status"] = "OK";
    if (!f || (!f.hasGatherReport && !f.hasDailyReport)) status = "NO_DATA";
    else if (!f.hasDailyReport) status = "MISSING_SUMMARY";
    else if (emptySummary) status = "EMPTY_SUMMARY";
    else if (f.stale) status = "STALE";

    rows.push({
      date: dateStr,
      hasGather: f?.hasGatherReport ?? false,
      hasDaily: f?.hasDailyReport ?? false,
      emailed: f?.emailed ?? false,
      stale: f?.stale ?? false,
      emptySummary,
      status,
    });
  }
  return rows;
}

export function printDoctorTable(rows: DoctorRow[]): void {
  const icon = (s: DoctorRow["status"]) => {
    switch (s) {
      case "OK": return "✅";
      case "STALE": return "⚠️ ";
      case "EMPTY_SUMMARY": return "⛔";
      case "MISSING_SUMMARY": return "❌";
      case "NO_DATA": return "⬜";
    }
  };
  console.log("");
  console.log("  sincenety doctor — recent summary health");
  console.log("  ┌────────────┬────────┬───────┬─────────┬──────────────────┐");
  console.log("  │ Date       │ Gather │ Daily │ Emailed │ Status           │");
  console.log("  ├────────────┼────────┼───────┼─────────┼──────────────────┤");
  for (const r of rows) {
    const statusCell = icon(r.status) + " " + r.status;
    console.log(
      "  │ " +
        r.date +
        " │   " + (r.hasGather ? "✅" : "❌") + "   │  " +
        (r.hasDaily ? "✅" : "❌") + "   │    " +
        (r.emailed ? "✅" : "⬜") + "    │ " +
        padEndW(statusCell, 17) +
        " │",
    );
  }
  console.log("  └────────────┴────────┴───────┴─────────┴──────────────────┘");
  const bad = rows.filter((r) => r.status !== "OK" && r.status !== "NO_DATA");
  if (bad.length > 0) {
    console.log("");
    console.log(`  ${bad.length} issue(s) to fix:`);
    for (const r of bad) {
      if (r.status === "MISSING_SUMMARY" || r.status === "EMPTY_SUMMARY") {
        console.log(`    • ${r.date}: run \`/sincenety\` or \`sincenety circle\` to summarize`);
      } else if (r.status === "STALE") {
        console.log(`    • ${r.date}: run \`sincenety circle --rerun ${r.date}\``);
      }
    }
  }
  console.log("");
}
