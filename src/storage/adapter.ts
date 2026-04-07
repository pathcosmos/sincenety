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
  getLatestGatherReport(): Promise<GatherReport | null>;
  updateReportEmail(reportId: number, emailedAt: number, emailTo: string): Promise<void>;

  // 설정
  getConfig(key: string): Promise<string | null>;
  setConfig(key: string, value: string): Promise<void>;

  // 갈무리 포인트
  getLastCheckpoint(): Promise<number | null>;
  saveCheckpoint(timestamp: number): Promise<void>;
}
