import { spawn } from 'node:child_process';

const child = spawn('node', ['dist/index.js'], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
const pending = new Map();
child.stdout.on('data', d => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
let id = 0;
const send = (method, params) => new Promise(res => {
  const myId = ++id;
  pending.set(myId, res);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
});
const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');

// 1) initialize
const init = await send('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'smoke', version: '0.0.0' },
});
console.log('initialize → server:', init.result?.serverInfo?.name, '| protocol:', init.result?.protocolVersion);
notify('notifications/initialized', {});

// 2) tools/list
const list = await send('tools/list', {});
const tool = list.result.tools[0];
console.log('tools/list →', list.result.tools.map(t => t.name).join(', '));
console.log('  input keys:', Object.keys(tool.inputSchema.properties || {}).join(', '));
console.log('  has outputSchema:', !!tool.outputSchema);

// 3) tools/call — 실제 견적 데이터
const call = await send('tools/call', {
  name: 'analyze_estimate',
  arguments: {
    billing: ['1.5억'],
    outsource: ['3,000만', '₩20,000,000', { label: '편집', amount: '1,000만' }, '△5,000,000'],
  },
});
console.log('\n=== tools/call: analyze_estimate ===');
console.log('--- text ---\n' + call.result.content[0].text);
console.log('--- structuredContent ---');
console.log(JSON.stringify(call.result.structuredContent, null, 2));

// 검증
const r = call.result.structuredContent;
const checks = [
  ['청구 1.5억 = 150,000,000', r.billingTotal === 150000000],
  ['외주 합계 = 30M+20M+10M-5M = 55,000,000', r.outsourceTotal === 55000000],
  ['내수 = 95,000,000', r.naesu === 95000000],
  ['내수율 = 63.3%', r.naesuRate === 63.3],
  ['△5,000,000 음수 인식', r.outsourceItems.some(i => i.amount === -5000000)],
  ['편집 라벨 유지', r.outsourceItems.some(i => i.label === '편집' && i.amount === 10000000)],
  ['통화 KRW', r.currency === 'KRW'],
];
console.log('\n=== 검증 ===');
let pass = true;
for (const [n, ok] of checks) { console.log(ok ? '✅' : '❌', n); if (!ok) pass = false; }
console.log(pass ? '\n🎉 SMOKE TEST ALL PASS' : '\n⚠ 실패');
child.kill();
process.exit(pass ? 0 : 1);
