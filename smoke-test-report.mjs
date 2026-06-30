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
  name: 'generate_campaign_report',
  arguments: {
    campaign_context: '브랜드: ACME / 목적: 여름 신제품 인지도 / 목표 KPI: VTR 20%, 노출 1,500만',
    media_data: '유튜브 노출 950만 VTR 20% CPV 35원, 네이버 노출 480만 VTR 15.6%. TOTAL 소진 8,000만.',
    consumer_data: '댓글 320개 중 긍정 68% 부정 12% 중립 20%. 키워드 "디자인 예쁘다" 급증, "가격 비싸다" 일부.',
  },
});
const text = call.result.content[0].text;
const sc = call.result.structuredContent;
console.log('\n--- text guide (앞 500자) ---\n' + text.slice(0, 500) + '\n...');
console.log('\n--- structuredContent.structure ---');
console.log(sc.structure.map(s => `${s.no}. ${s.title}`).join('\n'));

// 검증: 빈 입력 → zod 검증 실패해야
const bad = await send('tools/call', { name: 'generate_campaign_report', arguments: { campaign_context: 'x', media_data: '', consumer_data: 'y' } });
const rejected = bad.error != null || bad.result?.isError === true;

const titles = ['캠페인 총평','미디어 성과','소비자 반응','미디어-소비자 연결 인사이트','다음 캠페인 제언'];
const checks = [
  ['analyze_estimate 유지', names.includes('analyze_estimate')],
  ['generate_campaign_report 추가', names.includes('generate_campaign_report')],
  ['structure 5개 섹션', sc.structure.length === 5],
  ['섹션 제목 5개 일치', titles.every((t, i) => sc.structure[i].title === t)],
  ['text 가이드에 5개 제목 포함', titles.every(t => text.includes(t))],
  ['입력 데이터 echo (미디어)', text.includes('950만') && sc.media_data.includes('950만')],
  ['instructions 포함', typeof sc.instructions === 'string' && sc.instructions.length > 10],
  ['빈 media_data → zod 검증 거부', rejected],
];
console.log('\n=== 검증 ===');
let pass = true; for (const [n, ok] of checks) { console.log(ok ? '✅' : '❌', n); if (!ok) pass = false; }
console.log(pass ? '\n🎉 REPORT TOOL TEST ALL PASS' : '\n⚠ 실패');
child.kill(); process.exit(pass ? 0 : 1);
