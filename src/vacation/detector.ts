/**
 * Keyword Detector — Google Calendar 이벤트에서 휴가 키워드 감지
 */

interface VacationPattern {
  type: string;
  patterns: RegExp[];
}

const VACATION_PATTERNS: VacationPattern[] = [
  {
    type: "half",
    patterns: [/반차/i, /half[\s-]?day/i],
  },
  {
    type: "sick",
    patterns: [/병가/i, /sick[\s-]?(leave|day)?/i],
  },
  {
    type: "holiday",
    patterns: [/공휴일/i, /holiday/i, /국경일/i],
  },
  {
    type: "other",
    patterns: [/대휴/i, /compensatory/i, /보상[\s]?휴가/i],
  },
  {
    type: "vacation",
    patterns: [/휴가/i, /vacation/i, /연차/i, /\bPTO\b/i, /annual[\s-]?leave/i],
  },
];

/**
 * 텍스트에 휴가 관련 키워드가 포함되어 있는지 확인
 */
export function isVacationKeyword(text: string): boolean {
  return VACATION_PATTERNS.some((vp) =>
    vp.patterns.some((p) => p.test(text)),
  );
}

/**
 * 텍스트에서 휴가 타입 감지 (첫 매칭 반환)
 */
export function detectVacationType(text: string): string | null {
  for (const vp of VACATION_PATTERNS) {
    for (const p of vp.patterns) {
      if (p.test(text)) {
        return vp.type;
      }
    }
  }
  return null;
}

/**
 * Google Calendar 이벤트 파싱 — 종일 이벤트 + 키워드 매칭
 */
export function parseCalendarEvent(
  summary: string,
  isAllDay: boolean,
): { isVacation: boolean; type: string } | null {
  if (!summary) return null;

  const type = detectVacationType(summary);
  if (!type) {
    return { isVacation: false, type: "" };
  }

  // 종일 이벤트이거나 키워드가 감지되면 휴가로 판단
  // (반차는 종일이 아닐 수 있으므로 키워드 매칭만으로 충분)
  return {
    isVacation: isAllDay || type === "half",
    type,
  };
}
