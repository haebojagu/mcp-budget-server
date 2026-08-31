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

/* ───────────────────────── generate_campaign_report ─────────────────────────
 * 계산 도구가 아니라, Claude에게 "이 형식으로 광고주 보고용 리포트를 써라"는
 * 구조화된 지침 + 정리된 입력 데이터를 반환하는 프롬프트 스캐폴딩 도구.
 */
const reportInputShape = {
  media_data: z
    .string()
    .min(1, 'media_data는 비어 있을 수 없습니다.')
    .describe('미디어팀 리포트 내용 — 숫자/표/텍스트 무엇이든 (노출·조회·VTR·CPV·채널별 성과 등)'),
  consumer_data: z
    .string()
    .min(1, 'consumer_data는 비어 있을 수 없습니다.')
    .describe('소비자 반응 — 댓글, 긍/부정, 키워드 언급량 등'),
  campaign_context: z
    .string()
    .min(1, 'campaign_context는 비어 있을 수 없습니다.')
    .describe('브랜드명, 캠페인 목적, 목표 KPI 등 배경 정보'),
};

const reportSection = z.object({
  no: z.number(),
  title: z.string(),
  guide: z.string().describe('이 섹션에 무엇을 써야 하는지에 대한 작성 지침'),
});
const reportOutputShape = {
  campaign_context: z.string(),
  media_data: z.string(),
  consumer_data: z.string(),
  structure: z.array(reportSection).describe('작성해야 할 리포트 섹션 5개 (순서·제목·지침)'),
  instructions: z.string().describe('Claude가 따라야 할 종합 작성 규칙'),
};

// 리포트 섹션 정의 (출력 구조 1~5)
const REPORT_SECTIONS = [
  { no: 1, title: '캠페인 총평', guide: '미디어 성과와 소비자 반응을 종합한 한 문단(3~5문장) 요약. 핵심 결론을 먼저 제시.' },
  { no: 2, title: '미디어 성과', guide: '핵심 KPI(노출·조회·VTR·CPV·소진 등)를 해석. 목표 KPI 대비 달성 여부와 채널별 효율을 강조. 수치는 입력 데이터에 있는 것만 사용.' },
  { no: 3, title: '소비자 반응', guide: '긍정/부정/중립 비율과 주요 반응·키워드를 정리. 인상적인 댓글, 언급량 변화 등 구체적 근거 포함.' },
  { no: 4, title: '미디어-소비자 연결 인사이트', guide: '성과가 좋았던 채널/소재와 소비자 반응의 상관관계를 연결. 어떤 매체 노출이 어떤 반응을 유발했는지 가설과 근거를 제시.' },
  { no: 5, title: '다음 캠페인 제언', guide: '데이터에 근거한 실행 가능한 제언 2~3가지. 예산 배분·채널 선택·메시지 방향 등 구체적으로.' },
];

function reportPrompt(ctx: string, media: string, consumer: string): string {
  const fmt = REPORT_SECTIONS.map(s => `${s.no}. ${s.title}\n   → ${s.guide}`).join('\n');
  return [
    '당신은 광고대행사 AE입니다. 아래 [입력 데이터]만 근거로, 광고주 보고용 "캠페인 리포트 초안"을 한국어로 작성하세요.',
    '',
    '[작성 형식] — 아래 5개 섹션을 이 순서·제목 그대로 작성',
    fmt,
    '',
    '[입력 데이터]',
    '■ 캠페인 컨텍스트',
    ctx,
    '',
    '■ 미디어 성과 데이터',
    media,
    '',
    '■ 소비자 반응 데이터',
    consumer,
    '',
    '[작성 규칙]',
    '- 각 섹션 제목을 그대로 사용하고, 섹션 순서를 지킬 것',
    '- 입력 데이터에 없는 수치·사실은 지어내지 말 것 (불충분하면 "데이터 부족"으로 명시)',
    '- 광고주가 읽는 문서이므로 전문적이되 간결하게, 결론을 먼저',
    '- 4번 섹션은 반드시 미디어 성과와 소비자 반응을 "연결"하는 인사이트일 것',
  ].join('\n');
}

server.registerTool(
  'generate_campaign_report',
  {
    title: '캠페인 리포트 초안 생성 가이드',
    description:
      '미디어 성과 + 소비자 반응 + 캠페인 컨텍스트를 입력받아, 광고주 보고용 캠페인 리포트를 ' +
      '작성하기 위한 구조화된 지침(5개 섹션)과 정리된 데이터를 반환합니다. ' +
      '계산 도구가 아니라, Claude가 이 구조대로 리포트를 작성하도록 안내하는 프롬프트 스캐폴딩입니다.',
    inputSchema: reportInputShape,
    outputSchema: reportOutputShape,
  },
  async ({ media_data, consumer_data, campaign_context }) => {
    const structured = {
      campaign_context,
      media_data,
      consumer_data,
      structure: REPORT_SECTIONS,
      instructions:
        '위 structure의 5개 섹션을 순서·제목 그대로 작성하되, 입력 데이터에 근거하고 수치를 지어내지 말 것. ' +
        '4번 섹션은 미디어 성과와 소비자 반응을 연결하는 인사이트여야 함.',
    };
    return {
      content: [{ type: 'text', text: reportPrompt(campaign_context, media_data, consumer_data) }],
      structuredContent: structured,
    };
  },
);

/* ───────────────────────── analyze_youtube_comments ─────────────────────────
 * 계산 도구가 아니라, Claude에게 "이 형식으로 유튜브 댓글을 정성 분석하라"는
 * 구조화된 지침 + 정리된 댓글 데이터를 반환하는 프롬프트 스캐폴딩 도구.
 * YouTube API 호출 없음 — 사용자가 붙여넣은 댓글 텍스트만 처리.
 */
const youtubeInputShape = {
  comments: z
    .string()
    .min(1, 'comments는 비어 있을 수 없습니다.')
    .describe('붙여넣은 유튜브 댓글 텍스트 (여러 줄 가능, 한 줄에 댓글 하나 정도)'),
  video_context: z
    .string()
    .optional()
    .describe('영상/캠페인에 대한 설명 (제목, 브랜드, 목적 등) — 선택'),
};

const youtubeSection = z.object({
  no: z.number(),
  title: z.string(),
  guide: z.string().describe('이 섹션에 무엇을 써야 하는지에 대한 작성 지침'),
});
const youtubeOutputShape = {
  video_context: z.string().optional(),
  comments: z.string(),
  structure: z.array(youtubeSection).describe('작성해야 할 분석 섹션 5개 (순서·제목·지침)'),
  instructions: z.string().describe('Claude가 따라야 할 종합 작성 규칙'),
};

// 댓글 분석 섹션 정의 (출력 구조 1~5)
const YOUTUBE_SECTIONS = [
  { no: 1, title: '감성 분포', guide: '긍정/부정/중립 비율을 추정. 실제 댓글 내용에 근거해 대략적인 퍼센트나 비중으로 제시.' },
  { no: 2, title: '대표 긍정 반응', guide: '긍정적인 댓글 중 대표적인 것을 실제 댓글 원문 그대로 인용하며 정리.' },
  { no: 3, title: '대표 부정/이슈 반응', guide: '부정적이거나 우려·불만이 담긴 댓글을 실제 원문 인용과 함께 플래그. 없으면 "특이 이슈 없음"으로 명시.' },
  { no: 4, title: '핵심 키워드', guide: '댓글에서 자주 등장한 단어·표현·주제를 추출해 나열.' },
  { no: 5, title: '종합 인사이트', guide: '위 내용을 종합해 캠페인 관점에서 시사하는 바를 제시. 다음 액션에 참고할 만한 결론 위주로.' },
];

function youtubePrompt(ctx: string | undefined, comments: string): string {
  const fmt = YOUTUBE_SECTIONS.map(s => `${s.no}. ${s.title}\n   → ${s.guide}`).join('\n');
  return [
    '당신은 광고대행사 AE입니다. 아래 [입력 데이터]만 근거로, 유튜브 댓글에 대한 "정성 분석"을 한국어로 작성하세요.',
    '',
    '[작성 형식] — 아래 5개 섹션을 이 순서·제목 그대로 작성',
    fmt,
    '',
    '[입력 데이터]',
    '■ 영상/캠페인 설명',
    ctx?.trim() || '(제공되지 않음)',
    '',
    '■ 댓글',
    comments,
    '',
    '[작성 규칙]',
    '- 각 섹션 제목을 그대로 사용하고, 섹션 순서를 지킬 것',
    '- 댓글 데이터에 없는 내용을 지어내지 말 것 — 반드시 실제 댓글만 근거로 삼을 것',
    '- 2번·3번 섹션은 실제 댓글을 그대로 인용할 것',
    '- 댓글이 적거나 판단이 애매하면 "데이터 부족"으로 명시',
  ].join('\n');
}

server.registerTool(
  'analyze_youtube_comments',
  {
    title: '유튜브 댓글 정성 분석 가이드',
    description:
      '붙여넣은 유튜브 댓글 텍스트(+ 선택적 영상/캠페인 설명)를 입력받아, ' +
      '감성 분포·대표 반응·핵심 키워드·종합 인사이트를 정성 분석하기 위한 구조화된 지침(5개 섹션)과 ' +
      '정리된 댓글 데이터를 반환합니다. YouTube API를 호출하지 않으며, 붙여넣은 텍스트만 처리합니다. ' +
      '계산 도구가 아니라, Claude가 이 구조대로 분석을 작성하도록 안내하는 프롬프트 스캐폴딩입니다.',
    inputSchema: youtubeInputShape,
    outputSchema: youtubeOutputShape,
  },
  async ({ comments, video_context }) => {
    const structured = {
      video_context,
      comments,
      structure: YOUTUBE_SECTIONS,
      instructions:
        '위 structure의 5개 섹션을 순서·제목 그대로 작성하되, 댓글 데이터에 근거하고 내용을 지어내지 말 것. ' +
        '2번·3번 섹션은 실제 댓글 원문을 인용할 것.',
    };
    return {
      content: [{ type: 'text', text: youtubePrompt(video_context, comments) }],
      structuredContent: structured,
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio 서버는 stdout을 프로토콜에 사용하므로 로그는 stderr로
  console.error(
    'mcp-budget-server (stdio) 시작됨 — analyze_estimate, generate_campaign_report, analyze_youtube_comments 도구 제공',
  );
}

main().catch(err => {
  console.error('mcp-budget-server 치명적 오류:', err);
  process.exit(1);
});
