/**
 * 유니코드 문자열의 터미널 표시 폭 계산 및 폭 기반 패딩 유틸리티
 */

/** 문자열의 표시 폭 계산 (CJK/한글/이모지=2, ASCII=1) */
export function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2fffd) ||
      // common emoji ranges
      (code >= 0x2600 && code <= 0x27bf) ||
      (code >= 0x1f300 && code <= 0x1f9ff)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** 표시 폭 기준으로 오른쪽 패딩 */
export function padEndW(str: string, width: number): string {
  const diff = width - displayWidth(str);
  return diff > 0 ? str + " ".repeat(diff) : str;
}

/** 표시 폭 기준으로 왼쪽 패딩 (숫자 정렬용) */
export function padStartW(str: string, width: number): string {
  const diff = width - displayWidth(str);
  return diff > 0 ? " ".repeat(diff) + str : str;
}
