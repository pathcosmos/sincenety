/**
 * Vacation CRUD operations — StorageAdapter 기반 휴가 관리
 */

import type { StorageAdapter, VacationRecord } from "../storage/adapter.js";

export interface VacationStats {
  total: number;
  byType: Record<string, number>;
  dates: string[];
}

/**
 * 휴가 등록 (여러 날짜 한번에 저장)
 */
export async function registerVacation(
  storage: StorageAdapter,
  dates: string[],
  type: string = "vacation",
  source: string = "manual",
  label: string | null = null,
): Promise<void> {
  const now = Date.now();
  for (const date of dates) {
    const record: VacationRecord = {
      date,
      type,
      source,
      label,
      createdAt: now,
    };
    await storage.saveVacation(record);
  }
}

/**
 * 기간 내 휴가 목록 조회
 */
export async function listVacations(
  storage: StorageAdapter,
  from: string,
  to: string,
): Promise<VacationRecord[]> {
  return storage.getVacationsByRange(from, to);
}

/**
 * 특정 날짜 휴가 삭제
 */
export async function removeVacation(
  storage: StorageAdapter,
  date: string,
): Promise<void> {
  await storage.deleteVacation(date);
}

/**
 * 특정 날짜가 휴가인지 확인
 */
export async function isVacationDay(
  storage: StorageAdapter,
  date: string,
): Promise<boolean> {
  const results = await storage.getVacationsByRange(date, date);
  return results.length > 0;
}

/**
 * 기간 내 휴가 통계
 */
export async function getVacationStats(
  storage: StorageAdapter,
  from: string,
  to: string,
): Promise<VacationStats> {
  const records = await storage.getVacationsByRange(from, to);
  const byType: Record<string, number> = {};
  const dates: string[] = [];

  for (const r of records) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    dates.push(r.date);
  }

  return {
    total: records.length,
    byType,
    dates,
  };
}
