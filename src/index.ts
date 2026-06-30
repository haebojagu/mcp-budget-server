#!/usr/bin/env node
/*
 * mcp-budget-server — 광고 AE 견적서 정산 MCP 서버 (stdio).
 *
 * 도구: analyze_estimate
 *   견적서 데이터(청구액 항목 + 외주비 항목)를 입력받아
 *   청구액 합계 · 외주비 합계 · 내수(청구−외주) · 내수율(%) 을 계산한다.
 *   금액 표기는 parse-amount(복사본)로 정규화: "1.5억", "△100,000", "1,000만" 등 처리.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { parseAmount } from './parse-amount.js';

// 입력 금액: 문자열("1.5억"/"95,120,000"/"△100,000") 또는 숫자, 또는 {label, amount}
const amountValue = z.union([z.string(), z.number()]);
const lineItem = z.union([
  amountValue,
  z.object({
    label: z.string().optional().describe('항목명(파일명/협력사명 등)'),
    amount: amountValue.describe('금액 (문자열 표기 가능)'),
  }),
]);
type LineItem = z.infer<typeof lineItem>;

const inputShape = {
  billing: z.array(lineItem).default([]).describe('청구액(클라이언트 청구) 항목들. 보통 1건이지만 여러 건 합산 가능.'),
  outsource: z.array(lineItem).default([]).describe('외주비(협력사 지급) 항목들. 여러 건 합산.'),
};

const normalizedItem = z.object({ label: z.string(), amount: z.number() });
const outputShape = {
  billingTotal: z.number().describe('청구액 합계 (원)'),
  outsourceTotal: z.number().describe('외주비 합계 (원)'),
  naesu: z.number().describe('내수 = 청구액 − 외주비 (원)'),
  naesuRate: z.number().describe('내수율(%) = 내수 / 청구액 × 100, 소수 1자리'),
  currency: z.literal('KRW'),
  billingItems: z.array(normalizedItem),
  outsourceItems: z.array(normalizedItem),
};

// {label, amount} 형태로 정규화 + parseAmount 적용
function normalize(items: LineItem[], fallbackPrefix: string): { label: string; amount: number }[] {
  return items.map((it, i) => {
    if (typeof it === 'string' || typeof it === 'number') {
      return { label: `${fallbackPrefix} ${i + 1}`, amount: parseAmount(it) };
    }
    return { label: it.label?.trim() || `${fallbackPrefix} ${i + 1}`, amount: parseAmount(it.amount) };
  });
}

const won = (n: number) => '₩' + Math.round(n).toLocaleString('ko-KR');

function analyze(billing: LineItem[], outsource: LineItem[]) {
  const billingItems = normalize(billing, '청구');
  const outsourceItems = normalize(outsource, '외주');
  const billingTotal = billingItems.reduce((s, e) => s + e.amount, 0);
  const outsourceTotal = outsourceItems.reduce((s, e) => s + e.amount, 0);
  const naesu = billingTotal - outsourceTotal;
  const naesuRate = billingTotal > 0 ? Math.round((naesu / billingTotal) * 1000) / 10 : 0;
  return { billingTotal, outsourceTotal, naesu, naesuRate, currency: 'KRW' as const, billingItems, outsourceItems };
}

function summaryText(r: ReturnType<typeof analyze>): string {
  const lines: string[] = [];
  lines.push('■ 견적서 정산 결과');
  lines.push(`  · 청구액 합계 : ${won(r.billingTotal)}`);
  lines.push(`  · 외주비 합계 : ${won(r.outsourceTotal)}`);
  lines.push(`  · 내수(청구−외주) : ${won(r.naesu)}`);
  lines.push(`  · 내수율 : ${r.naesuRate.toFixed(1)}%`);
  if (r.billingItems.length) {
    lines.push('  [청구 항목]');
    r.billingItems.forEach(e => lines.push(`    - ${e.label} : ${won(e.amount)}`));
  }
  if (r.outsourceItems.length) {
    lines.push('  [외주 항목]');
    r.outsourceItems.forEach(e => lines.push(`    - ${e.label} : ${won(e.amount)}`));
  }
  return lines.join('\n');
}

const server = new McpServer({ name: 'mcp-budget-server', version: '1.0.0' });

server.registerTool(
  'analyze_estimate',
  {
    title: '견적서 정산 분석',
    description:
      '광고 견적서/청구서 데이터를 입력받아 청구액 합계·외주비 합계·내수(청구−외주)·내수율(%)을 계산합니다. ' +
      '금액은 "1.5억", "1,000만", "₩95,120,000", "△100,000"(음수) 같은 표기를 모두 인식합니다.',
    inputSchema: inputShape,
    outputSchema: outputShape,
  },
  async ({ billing, outsource }) => {
    const result = analyze(billing ?? [], outsource ?? []);
    return {
      content: [{ type: 'text', text: summaryText(result) }],
      structuredContent: result,
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio 서버는 stdout을 프로토콜에 사용하므로 로그는 stderr로
  console.error('mcp-budget-server (stdio) 시작됨 — analyze_estimate 도구 제공');
}

main().catch(err => {
  console.error('mcp-budget-server 치명적 오류:', err);
  process.exit(1);
});
