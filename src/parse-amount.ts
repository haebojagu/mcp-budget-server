/*
 * 금액 문자열 범용 파서 — sns-dashboard의 src/lib/parse-amount.ts 복사본.
 * (원본을 수정하지 않고 이 MCP 서버 전용으로 독립 복사해 사용)
 * 견적서·청구서에 흔한 표기를 정수(원)로 정규화한다.
 *
 *   "1,000,000"   →  1000000
 *   "100만"        →  1000000
 *   "1.5억"        →  150000000
 *   "3억5천만"     →  350000000
 *   "△100,000"    →  -100000   (회계식 음수: △ ▲ ▽)
 *   "(100,000)"   →  -100000   (괄호 음수)
 *   "₩ 95,120,000" →  95120000
 */

// 한글 자릿수 단위 (큰 단위 → 작은 단위)
const BIG_UNITS: [string, number][] = [
  ['조', 1e12],
  ['억', 1e8],
  ['만', 1e4],
];
const SMALL_UNITS: [string, number][] = [
  ['천', 1e3],
  ['백', 1e2],
  ['십', 1e1],
];

// "5천", "1.5", "5천5백" 같은 만 단위 미만 묶음 해석
function parseSmallGroup(s: string): number {
  if (!s) return 1; // "만" 앞에 숫자 없으면 1만으로 간주
  let total = 0;
  let rest = s;
  let matched = false;
  for (const [unit, mul] of SMALL_UNITS) {
    const i = rest.indexOf(unit);
    if (i < 0) continue;
    matched = true;
    const head = rest.slice(0, i);
    total += (head === '' ? 1 : parseFloat(head) || 0) * mul;
    rest = rest.slice(i + 1);
  }
  if (rest) total += parseFloat(rest) || 0;
  else if (!matched) return parseFloat(s) || 0;
  return total;
}

// 한글 단위가 섞인 문자열 해석 ("3억5천만", "1.5억", "100만")
function parseKoreanUnits(input: string): number {
  let total = 0;
  let rest = input;
  for (const [unit, mul] of BIG_UNITS) {
    const i = rest.indexOf(unit);
    if (i < 0) continue;
    total += parseSmallGroup(rest.slice(0, i)) * mul;
    rest = rest.slice(i + 1);
  }
  if (rest) total += parseSmallGroup(rest);
  return total;
}

/** 금액 문자열을 정수(원)로 정규화. 못 읽으면 0. 음수 표기 지원. */
export function parseAmount(raw: unknown): number {
  let s = String(raw ?? '').trim();
  if (!s) return 0;

  // 음수 판별: 선행 △ ▲ ▽ -, 또는 괄호로 감싼 값
  let neg = false;
  const parenMatch = s.match(/^\((.*)\)$/);
  if (parenMatch) {
    neg = true;
    s = parenMatch[1].trim();
  }
  if (/^[-−–△▲▽]/.test(s)) neg = true;

  // 음수 기호·통화 기호·공백 제거 (숫자/소수점/콤마/한글 단위만 남김)
  s = s.replace(/[△▲▽−–\-₩원\s]/g, '');
  if (!s) return 0;

  let val: number;
  if (/[조억만천백십]/.test(s)) {
    // 한글 단위 곱셈은 부동소수 오차가 생길 수 있어 정수(원)로 반올림
    val = Math.round(parseKoreanUnits(s.replace(/,/g, '')));
  } else {
    const cleaned = s.replace(/,/g, '').replace(/[^0-9.]/g, '');
    val = parseFloat(cleaned);
  }

  if (!Number.isFinite(val)) return 0;
  return neg ? -val : val;
}
