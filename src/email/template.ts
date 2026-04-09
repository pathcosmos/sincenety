/**
 * sincenety 이메일 HTML 템플릿 v5
 *
 * 디자인: "Bright Color-Coded Dashboard"
 * — 밝은 배경에 세션별 고유 컬러로 영역 구분
 * — 갈무리 요약 최상단 배치
 * — 섹션별 배경색 차별화
 */

import type { SessionGroup } from "../grouper/session.js";

// ── 색상 팔레트 (Bright) ──
const C = {
  bg: "#f5f5f7",
  card: "#ffffff",
  text: "#1a1a1a",
  textMuted: "#6b7280",
  textDim: "#9ca3af",
  white: "#ffffff",
  dark: "#111827",
  border: "#e5e7eb",
  borderLight: "#f0f0f0",
  accent: "#b45309",         // 앰버 다크
  accentBg: "#fef3c7",       // 앰버 연한 배경
  cyan: "#0e7490",
  blue: "#2563eb",
  purple: "#7c3aed",
  green: "#059669",
  red: "#dc2626",
  orange: "#ea580c",
  mono: "'SF Mono','Fira Code',Menlo,Consolas,monospace",
  sans: "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR',sans-serif",
} as const;

// 세션별 고유 컬러 (밝은 배경용 — 진한 톤)
const SESSION_COLORS = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626", "#ea580c"];
// 세션별 연한 배경
const SESSION_BG = ["#eff6ff", "#ecfdf5", "#fffbeb", "#f5f3ff", "#fef2f2", "#fff7ed"];
// 세션별 중간 톤 (헤더 바)
const SESSION_HEADER_BG = ["#dbeafe", "#d1fae5", "#fef3c7", "#ede9fe", "#fee2e2", "#ffedd5"];

// ── 유틸 ──
function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
}
function fmtDur(min: number): string {
  if (min < 1) return "< 1 min";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
/** XML/시스템 태그를 제거한 뒤 HTML 이스케이프 */
function esc(s: string): string {
  const cleaned = s
    .replace(/<[^>]*>/g, "")                       // XML/HTML 태그 제거
    .replace(/Caveat:.*?(?=\n|$)/gi, "")           // 시스템 메시지
    .replace(/Base directory for this skill:.*?(?=\n|$)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// ── 인터페이스 ──
export interface UserAction {
  time: string;
  input: string;
  result: string;
  significance: string;
}

export interface SessionData {
  sessionId: string;
  projectName: string;
  startedAt: number;
  endedAt: number;
  durationMinutes: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  title: string;
  summary: string;
  description: string;
  model: string;
  category: string;
  actions: UserAction[];
  wrapUp?: {
    outcome: string;
    significance: string;
    flow?: string;
    nextSteps?: string;
  };
}

export interface EmailData {
  sessions: SessionData[];
  fromTimestamp: number;
  toTimestamp: number;
  gatheredAt: number;
  totalCostUsd?: number;
  totalCacheTokens?: number;
  dailyOverview?: string;
}

// ── 섹션 헤더 (컬러 배경 바) ──
function sectionBar(num: string, emoji: string, title: string, bgColor: string, textColor = "#374151"): string {
  return `<tr><td style="padding:20px 0 12px 0">
    <div style="background:${bgColor};border-radius:8px;padding:12px 18px">
      <span style="display:inline-block;background:${textColor}15;border-radius:4px;padding:2px 7px;font-size:10px;color:${textColor};font-weight:700;font-family:${C.mono};margin-right:10px">${num}</span>
      <span style="font-size:11px;color:${textColor};letter-spacing:1.5px;text-transform:uppercase;font-weight:700">${emoji}&nbsp;&nbsp;${title}</span>
    </div>
  </td></tr>`;
}

// ── 갈무리 요약 카드 (Section 1) ──
function wrapUpCard(s: SessionData, idx: number): string {
  const color = SESSION_COLORS[idx % SESSION_COLORS.length];
  const bg = SESSION_BG[idx % SESSION_BG.length];
  const dots = ["🔵", "🟢", "🟡", "🟣", "🔴", "🟠"];
  const dot = dots[idx % dots.length];

  // wrapUp에서 가져오되, fallback도 태그 정리된 텍스트 사용
  const outcome = s.wrapUp?.outcome || s.description || s.title || s.summary;
  const significance = s.wrapUp?.significance || s.title || s.summary;
  const flow = s.wrapUp?.flow || "";
  const nextSteps = s.wrapUp?.nextSteps;
  const tokens = s.totalTokens;

  // 호환성을 위해 border-left 대신 중첩 테이블
  return `<tr><td style="padding:0 0 10px 0">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden">
      <tr>
        <td width="5" style="background:${color};width:5px;font-size:0">&nbsp;</td>
        <td style="background:${bg};padding:14px 18px">
          <!-- 프로젝트명 + 스탯 -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <span style="font-size:13px">${dot}</span>
                <span style="font-size:13px;color:${color};font-weight:700;margin-left:4px">${esc(s.projectName)}</span>
                <span style="font-size:11px;color:${C.textDim};margin-left:8px">${fmtTime(s.startedAt)} → ${fmtTime(s.endedAt)}</span>
              </td>
              <td align="right">
                <span style="font-size:10px;color:${C.textMuted}">${fmtDur(s.durationMinutes)} · ${s.messageCount}msg${tokens > 0 ? ` · ${fmtTok(tokens)}tok` : ""}</span>
              </td>
            </tr>
          </table>
          <!-- 결과물 -->
          <div style="margin-top:10px">
            <div style="font-size:11px">
              <span style="color:${C.accent}">📦</span>
              <span style="color:${C.textDim};font-size:10px;font-weight:600;margin:0 6px">Result</span>
              <span style="color:${C.text};line-height:1.5">${esc(trunc(outcome, 100))}</span>
            </div>
          </div>
          ${flow ? `
          <!-- 작업 흐름 -->
          <div style="margin-top:6px">
            <div style="font-size:11px">
              <span style="color:${C.accent}">🔄</span>
              <span style="color:${C.textDim};font-size:10px;font-weight:600;margin:0 6px">Flow</span>
              <span style="color:${C.textMuted};line-height:1.5">${esc(trunc(flow, 120))}</span>
            </div>
          </div>` : ""}
          <!-- 의미 -->
          <div style="margin-top:6px">
            <div style="font-size:11px">
              <span style="color:${C.accent}">💡</span>
              <span style="color:${C.textDim};font-size:10px;font-weight:600;margin:0 6px">Significance</span>
              <span style="color:${C.cyan};line-height:1.5">${esc(trunc(significance, 120))}</span>
            </div>
          </div>
          ${nextSteps ? `
          <!-- 후속 -->
          <div style="margin-top:6px">
            <div style="font-size:11px">
              <span style="color:${C.accent}">➡️</span>
              <span style="color:${C.textDim};font-size:10px;font-weight:600;margin:0 6px">Next</span>
              <span style="color:${C.textMuted};font-style:italic;line-height:1.5">${esc(trunc(nextSteps, 100))}</span>
            </div>
          </div>` : ""}
        </td>
      </tr>
    </table>
  </td></tr>`;
}

// ── 스탯 카드 ──
function statCard(emoji: string, value: string, label: string, bgTint: string, valueColor: string = C.white): string {
  return `<td width="25%" style="padding:0 4px">
    <div style="background:${bgTint};border-radius:10px;border:1px solid ${C.border};padding:14px 8px;text-align:center">
      <div style="font-size:20px;line-height:1">${emoji}</div>
      <div style="font-size:22px;color:${valueColor};font-weight:800;margin-top:5px;font-family:${C.mono};letter-spacing:-0.5px">${value}</div>
      <div style="font-size:9px;color:${C.textDim};margin-top:3px;letter-spacing:1px;text-transform:uppercase">${label}</div>
    </div>
  </td>`;
}

// ── 작업 행 ──
function actionRow(action: UserAction, isLast: boolean): string {
  return `<tr>
    <td style="padding:7px 0;border-bottom:${isLast ? "none" : `1px solid ${C.border}`}">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="48" style="vertical-align:top;padding-right:8px">
            <div style="font-size:10px;color:${C.textDim};font-family:${C.mono}">${esc(action.time)}</div>
          </td>
          <td style="vertical-align:top">
            <div style="font-size:12px;color:${C.text};line-height:1.5">${esc(trunc(action.input, 60))}</div>
            ${action.result ? `<div style="font-size:11px;color:${C.cyan};margin-top:2px">→ ${esc(trunc(action.result, 70))}</div>` : ""}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

// ── 메인 렌더 ──
export function renderEmailHtml(data: EmailData): string {
  const { sessions, fromTimestamp, toTimestamp } = data;
  const dateStr = fmtDate(toTimestamp);
  const totalMsg = sessions.reduce((s, g) => s + g.messageCount, 0);
  const totalIn = sessions.reduce((s, g) => s + g.inputTokens, 0);
  const totalOut = sessions.reduce((s, g) => s + g.outputTokens, 0);
  const totalTok = totalIn + totalOut;
  const totalDur = sessions.reduce((s, g) => s + g.durationMinutes, 0);

  // Section 1: 갈무리 요약 카드들
  const wrapUpCards = sessions.map((s, i) => wrapUpCard(s, i)).join("");

  // Section 3: 세션 상세 로그 카드들
  const sessionCards = sessions.map((s, idx) => {
    const color = SESSION_COLORS[idx % SESSION_COLORS.length];
    const bg = SESSION_BG[idx % SESSION_BG.length];
    const tokens = s.totalTokens;

    // Gmail 102KB 클립 방지: actions를 최대 5개로 제한
    const maxActions = 5;
    const trimmedActions = s.actions.length > maxActions ? s.actions.slice(0, maxActions) : s.actions;
    const actionsHtml = trimmedActions.length > 0
      ? trimmedActions.map((a, i) => actionRow(a, i === trimmedActions.length - 1)).join("")
        + (s.actions.length > maxActions ? `<tr><td style="padding:4px 0;font-size:10px;color:${C.textDim};text-align:center">… +${s.actions.length - maxActions} more</td></tr>` : "")
      : `<tr><td style="padding:6px 0;font-size:11px;color:${C.textMuted}">${esc(trunc(s.description || s.summary, 100))}</td></tr>`;

    return `<tr><td style="padding:0 0 12px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden">
        <tr>
          <td width="4" style="background:${color};width:4px;font-size:0">&nbsp;</td>
          <td>
            <!-- 컬러 헤더 바 -->
            <div style="background:${SESSION_HEADER_BG[idx % SESSION_HEADER_BG.length]};padding:12px 18px;border-bottom:1px solid ${C.border}">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:12px;color:${color};font-weight:700;letter-spacing:0.5px;text-transform:uppercase">
                    ${esc(s.projectName)}
                  </td>
                  <td align="right" style="font-size:10px;color:${C.textDim};font-family:${C.mono}">
                    ${fmtTime(s.startedAt)} → ${fmtTime(s.endedAt)}
                  </td>
                </tr>
              </table>
              <div style="margin-top:6px;font-size:14px;color:${C.text};font-weight:600">${esc(trunc(s.title, 50))}</div>
              <div style="margin-top:8px">
                <span style="display:inline-block;background:${C.bg};border-radius:5px;padding:2px 7px;font-size:9px;color:${C.textMuted};margin-right:4px">⏱️${fmtDur(s.durationMinutes)}</span>
                <span style="display:inline-block;background:${C.bg};border-radius:5px;padding:2px 7px;font-size:9px;color:${C.textMuted};margin-right:4px">💬${s.messageCount}</span>
                ${tokens > 0 ? `<span style="display:inline-block;background:${C.bg};border-radius:5px;padding:2px 7px;font-size:9px;color:${C.accent}">⚡${fmtTok(tokens)}</span>` : ""}
              </div>
            </div>
            <!-- 작업 목록 -->
            <div style="background:${bg};padding:10px 18px 14px 18px">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${actionsHtml}
              </table>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>`;
  }).join("\n");

  // Section 4: 하루의 성과 — 세션별 작업 흐름 요약
  const achieveCards = sessions.map((s, idx) => {
    const color = SESSION_COLORS[idx % SESSION_COLORS.length];
    const bg = SESSION_BG[idx % SESSION_BG.length];
    const dots = ["🔵", "🟢", "🟡", "🟣", "🔴", "🟠"];

    // 주제: 첫 의미 있는 작업
    const topic = s.wrapUp?.significance || s.title || s.summary;
    // 흐름: 작업 전체 진행 (outcome = 주요 입력들 → 연결)
    const flow = s.wrapUp?.outcome || s.description || s.summary;

    return `<div style="padding:12px 0;${idx < sessions.length - 1 ? `border-bottom:1px solid ${C.border};` : ""}">
      <!-- 프로젝트 + 주제 -->
      <div>
        <span style="font-size:12px">${dots[idx % dots.length]}</span>
        <span style="font-size:13px;color:${color};font-weight:700;margin:0 6px">${esc(s.projectName)}</span>
        <span style="font-size:10px;color:${C.textDim}">${fmtDur(s.durationMinutes)} · ${s.messageCount}msg</span>
      </div>
      <!-- 핵심 주제 -->
      <div style="margin-top:6px;font-size:12px;color:${C.text};font-weight:600">
        📌 ${esc(trunc(topic, 80))}
      </div>
      <!-- 작업 흐름 -->
      <div style="margin-top:4px;font-size:11px;color:${C.textMuted};line-height:1.6">
        ${esc(trunc(flow, 120))}
      </div>
    </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${C.sans};-webkit-font-smoothing:antialiased">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}">
<tr><td align="center" style="padding:24px 16px 16px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- ═══ 헤더 ═══ -->
  <tr><td>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-size:26px;line-height:1">📋</td>
        <td style="padding-left:10px">
          <div style="font-size:10px;color:${C.accent};font-weight:800;letter-spacing:2.5px">SINCENETY</div>
          <div style="font-size:9px;color:${C.textDim};letter-spacing:1px;margin-top:1px">Work Session Report</div>
        </td>
        <td align="right" style="font-size:12px;color:${C.textMuted}">${dateStr}</td>
      </tr>
    </table>
    <div style="margin-top:14px;height:2px;background:linear-gradient(90deg,${C.accent},${C.accent}33,transparent)"></div>
  </td></tr>

  ${data.dailyOverview ? `
  <!-- ═══ 일일보고 Overview ═══ -->
  <tr><td style="padding:16px 0 8px 0">
    <div style="background:linear-gradient(135deg,#fef3c7,#fff7ed);border-radius:12px;border:1px solid #fcd34d;padding:18px 22px">
      <div style="font-size:10px;color:#92400e;font-weight:800;letter-spacing:2px;margin-bottom:8px">📝 Today's Summary</div>
      <div style="font-size:13px;color:#1a1a1a;line-height:1.7">${esc(data.dailyOverview)}</div>
    </div>
  </td></tr>` : ""}

  <!-- ═══ SECTION 1: 세션 갈무리 요약 (최상단) ═══ -->
  ${sectionBar("01", "✍️", "Session Summary", "#e0e7ff", "#3730a3")}
  ${wrapUpCards}

  <!-- ═══ SECTION 2: 오늘의 수치 ═══ -->
  ${sectionBar("02", "📊", "Today's Stats", "#dbeafe", "#1e40af")}
  <tr><td style="padding:0 0 4px 0">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        ${statCard("🗂️", String(sessions.length), "sessions", "#eff6ff", C.blue)}
        ${statCard("💬", totalMsg > 999 ? fmtTok(totalMsg) : String(totalMsg), "messages", "#ecfdf5", C.green)}
        ${statCard("⚡", fmtTok(totalTok), "tokens", "#fffbeb", C.accent)}
        ${statCard("⏱️", fmtDur(totalDur), "duration", "#f5f3ff", C.purple)}
      </tr>
    </table>
  </td></tr>

  ${data.totalCostUsd != null ? `
  <tr><td style="padding:4px 0 0 0">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="50%" style="padding:0 4px 0 0">
          <div style="background:#ecfdf5;border-radius:10px;border:1px solid ${C.border};padding:12px 16px;text-align:center">
            <div style="font-size:9px;color:${C.textDim};letter-spacing:1px;text-transform:uppercase">💵 cost</div>
            <div style="font-size:20px;color:${C.green};font-weight:800;margin-top:4px;font-family:${C.mono}">$${data.totalCostUsd.toFixed(2)}</div>
          </div>
        </td>
        <td width="50%" style="padding:0 0 0 4px">
          <div style="background:#f5f3ff;border-radius:10px;border:1px solid ${C.border};padding:12px 16px;text-align:center">
            <div style="font-size:9px;color:${C.textDim};letter-spacing:1px;text-transform:uppercase">📊 Tokens (w/ cache)</div>
            <div style="font-size:20px;color:${C.purple};font-weight:800;margin-top:4px;font-family:${C.mono}">${fmtTok(data.totalCacheTokens ?? 0)}</div>
          </div>
        </td>
      </tr>
    </table>
  </td></tr>` : ""}

  ${totalTok > 0 ? `
  <tr><td style="padding:8px 0 0 0">
    <div style="background:${C.card};border-radius:10px;border:1px solid ${C.border};padding:10px 16px">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:10px;color:${C.textDim}">Input/Output ratio</td>
          <td align="right" style="font-size:10px;color:${C.textDim};font-family:${C.mono}">in ${fmtTok(totalIn)} · out ${fmtTok(totalOut)}</td>
        </tr>
      </table>
      <div style="margin-top:6px;width:100%;height:6px;border-radius:3px;background:${C.bg};overflow:hidden">
        <div style="float:left;height:6px;width:${Math.max(3, Math.round((totalIn / totalTok) * 100))}%;background:${C.blue}"></div>
        <div style="float:left;height:6px;width:${Math.round((totalOut / totalTok) * 100)}%;background:${C.purple}"></div>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px">
        <tr>
          <td style="font-size:9px;color:${C.blue}">● Input ${Math.round((totalIn / totalTok) * 100)}%</td>
          <td align="right" style="font-size:9px;color:${C.purple}">● Output ${Math.round((totalOut / totalTok) * 100)}%</td>
        </tr>
      </table>
    </div>
  </td></tr>` : ""}

  <!-- ═══ SECTION 3: 세션별 상세 작업 로그 ═══ -->
  ${sectionBar("03", "📌", "Session Detail Log", "#f3f4f6", "#374151")}
  ${sessionCards}

  <!-- ═══ SECTION 4: 하루의 성과 ═══ -->
  ${sectionBar("04", "🎯", "Today's Achievements", "#fef3c7", "#92400e")}
  <tr><td style="padding:0 0 8px 0">
    <div style="background:${C.white};border-radius:10px;border:1px solid ${C.border};padding:14px 18px">
      ${achieveCards}
    </div>
  </td></tr>

  <!-- ═══ 푸터 ═══ -->
  <tr><td style="padding:16px 0 0 0">
    <div style="height:1px;background:${C.border}"></div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">
      <tr>
        <td style="font-size:9px;color:${C.textDim}">sincenety · work session tracker</td>
        <td align="right" style="font-size:9px;color:${C.textDim};font-family:${C.mono}">${fmtTime(fromTimestamp)} → ${fmtTime(toTimestamp)}</td>
      </tr>
    </table>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
