import { spawn } from 'node:child_process';
const child = spawn('node', ['dist/index.js'], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = ''; const pending = new Map();
child.stdout.on('data', d => { buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!l) continue; const m = JSON.parse(l); if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } });
let id = 0;
const send = (method, params) => new Promise(r => { const myId = ++id; pending.set(myId, r); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n'); });
const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');

await send('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
notify('notifications/initialized', {});

const list = await send('tools/list', {});
const names = list.result.tools.map(t => t.name);
console.log('tools/list →', names.join(', '));

const call = await send('tools/call', {
  name: 'analyze_youtube_comments',
  arguments: {
    video_context: '브랜드: ACME / 여름 신제품 티저 영상',
    comments: [
      '디자인 진짜 예쁘다 바로 삽니다',
      '이거 가격 너무 비싼거 아님?',
      '색감 미쳤다 갖고싶어요',
      '배송 왜 이렇게 느려요...',
      '광고인데 퀄리티 좋네요',
    ].join('\n'),
  },
});
const text = call.result.content[0].text;
const sc = call.result.structuredContent;
console.log('\n--- text guide (앞 500자) ---\n' + text.slice(0, 500) + '\n...');
console.log('\n--- structuredContent.structure ---');
console.log(sc.structure.map(s => `${s.no}. ${s.title}`).join('\n'));

// 검증: 빈 comments → zod 검증 실패해야
const bad = await send('tools/call', { name: 'analyze_youtube_comments', arguments: { comments: '' } });
const rejected = bad.error != null || bad.result?.isError === true;

// 검증: video_context 없이도 동작해야 (선택 항목)
const noCtx = await send('tools/call', { name: 'analyze_youtube_comments', arguments: { comments: '좋아요 최고' } });
const noCtxOk = noCtx.error == null && noCtx.result?.isError !== true;

const titles = ['감성 분포', '대표 긍정 반응', '대표 부정/이슈 반응', '핵심 키워드', '종합 인사이트'];
const checks = [
  ['analyze_estimate 유지', names.includes('analyze_estimate')],
  ['generate_campaign_report 유지', names.includes('generate_campaign_report')],
  ['analyze_youtube_comments 추가', names.includes('analyze_youtube_comments')],
  ['structure 5개 섹션', sc.structure.length === 5],
  ['섹션 제목 5개 일치', titles.every((t, i) => sc.structure[i].title === t)],
  ['text 가이드에 5개 제목 포함', titles.every(t => text.includes(t))],
  ['입력 댓글 echo', text.includes('가격 너무 비싼거') && sc.comments.includes('가격 너무 비싼거')],
  ['video_context echo', sc.video_context === '브랜드: ACME / 여름 신제품 티저 영상'],
  ['instructions 포함', typeof sc.instructions === 'string' && sc.instructions.length > 10],
  ['빈 comments → zod 검증 거부', rejected],
  ['video_context 없어도 동작(선택값)', noCtxOk],
];
console.log('\n=== 검증 ===');
let pass = true; for (const [n, ok] of checks) { console.log(ok ? '✅' : '❌', n); if (!ok) pass = false; }
console.log(pass ? '\n🎉 YOUTUBE TOOL TEST ALL PASS' : '\n⚠ 실패');
child.kill(); process.exit(pass ? 0 : 1);
