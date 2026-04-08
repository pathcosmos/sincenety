/**
 * Storage Adapter 인터페이스 — sql.js(기본), MariaDB(옵션) 등 교체 가능
 */

export interface SessionRecord {
  id: string;
  project: string;
  projectName: string;
  startedAt: number;
  endedAt: number;
  durationMinutes: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  // 토큰
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  // 작업 내용
  title: string;
  summary: string;
  description: string;
  category: string;
  tags: string;
  model: string;
  // 메타
  createdAt: number;
}

export interface GatherReport {
  id?: number;
  gatheredAt: number;
  fromTimestamp: number;
  toTimestamp: number;
  sessionCount: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  reportMarkdown: string;
  reportJson: string;
  emailedAt: number | null;
  emailTo: string | null;
  reportDate: string | null;    // YYYY-MM-DD for date-based upsert
  dataHash: string | null;
  updatedAt: number | null;
}

export interface DailyReport {
  id?: number;
  reportDate: string;                                  // 'YYYY-MM-DD'
  reportType: "daily" | "weekly" | "monthly";
  periodFrom: number;
  periodTo: number;
  sessionCount: number;
  totalMessages: number;
  totalTokens: number;
  summaryJson: string;                                 // AI 요약 배열 JSON
  overview: string | null;                             // 종합 서술
  reportMarkdown: string | null;
  createdAt: number;
  emailedAt: number | null;
  emailTo: string | null;
  status: string | null;         // "in_progress" | "finalized"
  progressLabel: string | null;  // "진행중 — 3/7일"
  dataHash: string | null;       // gather data hash for change detection
}

export interface VacationRecord {
  id?: number;
  date: string;           // YYYY-MM-DD
  type: string;           // vacation | sick | holiday | half | other
  source: string;         // manual | gcal_auto
  label: string | null;
  createdAt: number;
}

export interface EmailLog {
  id?: number;
  sentAt: number;
  reportType: string;     // daily | weekly | monthly
  reportDate: string;
  periodFrom: string;
  periodTo: string;
  recipient: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  provider: string;       // gmail_mcp | resend | gmail_smtp | custom_smtp
  status: string;         // sent | failed | draft
  errorMessage: string | null;
}

export interface StorageAdapter {
  initialize(): Promise<void>;
  close(): Promise<void>;

  // 세션 저장/조회
  upsertSession(session: SessionRecord): Promise<void>;
  upsertSessions(sessions: SessionRecord[]): Promise<void>;
  getSessionsByDate(dateStr: string): Promise<SessionRecord[]>;
  getSessionsByRange(from: number, to: number): Promise<SessionRecord[]>;

  // 갈무리 리포트
  saveGatherReport(report: GatherReport): Promise<number>;
  getGatherReportsByDate(dateStr: string): Promise<GatherReport[]>;
  getGatherReportByDate(date: string): Promise<GatherReport | null>;
  getLatestGatherReport(): Promise<GatherReport | null>;
  updateReportEmail(reportId: number, emailedAt: number, emailTo: string): Promise<void>;

  // 일일/주간/월간 보고
  saveDailyReport(report: DailyReport): Promise<number>;
  getDailyReport(date: string, type?: string): Promise<DailyReport | null>;
  getDailyReportsByRange(from: string, to: string, type?: string): Promise<DailyReport[]>;
  getLatestDailyReport(type?: string): Promise<DailyReport | null>;
  updateDailyReportEmail(reportId: number, emailedAt: number, emailTo: string): Promise<void>;
  updateDailyReportStatus(reportDate: string, reportType: string, status: string, progressLabel?: string): Promise<void>;

  // 휴가
  saveVacation(vacation: VacationRecord): Promise<void>;
  getVacationsByRange(from: string, to: string): Promise<VacationRecord[]>;
  deleteVacation(date: string): Promise<void>;

  // 이메일 로그
  saveEmailLog(log: EmailLog): Promise<void>;
  getEmailLogs(limit: number): Promise<EmailLog[]>;

  // 설정
  getConfig(key: string): Promise<string | null>;
  setConfig(key: string, value: string): Promise<void>;

  // 갈무리 포인트
  getLastCheckpoint(): Promise<number | null>;
  saveCheckpoint(timestamp: number): Promise<void>;
}
