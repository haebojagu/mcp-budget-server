import { spawn } from 'node:child_process';

// YOUTUBE_API_KEY 미설정 상태를 확정적으로 테스트하기 위해 환경변수에서 제거
const baseEnv = { ...process.env };
delete baseEnv.YOUTUBE_API_KEY;

function startServer(env) {
  const child = spawn('node', ['dist/index.js'], { stdio: ['pipe', 'pipe', 'inherit'], env });
  let buf = ''; const pending = new Map();
  child.stdout.on('data', d => { buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!l) continue; const m = JSON.parse(l); if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } });
  let id = 0;
  const send = (method, params) => new Promise(r => { const myId = ++id; pending.set(myId, r); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n'); });
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  return { child, send, notify };
}

const checks = [];
const check = (name, ok) => checks.push([name, ok]);

// ── 서버 A: YOUTUBE_API_KEY 없음 ──────────────────────────────────────────
{
  const { child, send, notify } = startServer(baseEnv);
  await send('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
  notify('notifications/initialized', {});

  const list = await send('tools/list', {});
  const names = list.result.tools.map(t => t.name);
  console.log('tools/list →', names.join(', '));
  check('analyze_estimate 유지', names.includes('analyze_estimate'));
  check('generate_campaign_report 유지', names.includes('generate_campaign_report'));
  check('analyze_youtube_comments 추가', names.includes('analyze_youtube_comments'));

  // 1) 정상: 수동 댓글만
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

  const titles = ['감성 분포', '대표 긍정 반응', '대표 부정/이슈 반응', '핵심 키워드', '종합 인사이트'];
  check('structure 5개 섹션', sc.structure.length === 5);
  check('섹션 제목 5개 일치', titles.every((t, i) => sc.structure[i].title === t));
  check('text 가이드에 5개 제목 포함', titles.every(t => text.includes(t)));
  check('입력 댓글 echo', text.includes('가격 너무 비싼거') && sc.comments.includes('가격 너무 비싼거'));
  check('video_context echo', sc.video_context === '브랜드: ACME / 여름 신제품 티저 영상');
  check('instructions 포함', typeof sc.instructions === 'string' && sc.instructions.length > 10);
  check('sources 배열 (수동만이면 빈 배열)', Array.isArray(sc.sources) && sc.sources.length === 0);
  check('warnings 배열 (수동만이면 빈 배열)', Array.isArray(sc.warnings) && sc.warnings.length === 0);

  // 2) 검증: comments/youtube_urls 둘 다 없음 → 거부
  const bad = await send('tools/call', { name: 'analyze_youtube_comments', arguments: {} });
  check('comments/youtube_urls 둘 다 없음 → 거부', bad.error != null || bad.result?.isError === true);

  // 3) video_context 없이도 동작해야 (선택 항목)
  const noCtx = await send('tools/call', { name: 'analyze_youtube_comments', arguments: { comments: '좋아요 최고' } });
  check('video_context 없어도 동작(선택값)', noCtx.error == null && noCtx.result?.isError !== true);

  // 4) youtube_urls만 있고 API 키 없음 → 안내 메시지 (에러 아님)
  const noKeyUrlsOnly = await send('tools/call', {
    name: 'analyze_youtube_comments',
    arguments: { youtube_urls: 'https://youtu.be/dQw4w9WgXcQ' },
  });
  const noKeyText = noKeyUrlsOnly.result?.content?.[0]?.text ?? '';
  check('키 없음 + urls만 → 안내 문구 포함', noKeyText.includes('YOUTUBE_API_KEY') && noKeyText.includes('.env'));
  check('키 없음 + urls만 → isError 아님(안내만 반환)', noKeyUrlsOnly.result?.isError !== true);

  // 5) comments + youtube_urls 둘 다 있고 API 키 없음 → 수동 댓글로는 정상 진행 + 경고 포함
  const noKeyBoth = await send('tools/call', {
    name: 'analyze_youtube_comments',
    arguments: { comments: '수동 댓글입니다', youtube_urls: 'https://youtu.be/dQw4w9WgXcQ' },
  });
  const noKeyBothSc = noKeyBoth.result?.structuredContent;
  check('키 없음 + comments도 있음 → 정상 진행(에러 아님)', noKeyBoth.result?.isError !== true);
  check('키 없음 + comments도 있음 → 수동 댓글 사용', noKeyBothSc?.comments?.includes('수동 댓글입니다'));
  check('키 없음 + comments도 있음 → warnings에 안내 포함', (noKeyBothSc?.warnings ?? []).some(w => w.includes('YOUTUBE_API_KEY')));

  child.kill();
}

// ── 서버 B: 가짜 YOUTUBE_API_KEY (인식 불가 URL 형식 처리 확인, 네트워크 호출 없음) ──
{
  const { child, send, notify } = startServer({ ...baseEnv, YOUTUBE_API_KEY: 'test-fake-key-for-smoke-test' });
  await send('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
  notify('notifications/initialized', {});

  const badUrl = await send('tools/call', {
    name: 'analyze_youtube_comments',
    arguments: { youtube_urls: 'https://example.com/not-a-youtube-link' },
  });
  const badUrlText = badUrl.result?.content?.[0]?.text ?? '';
  check('키 있음 + 인식불가 URL → isError(분석할 데이터 없음)', badUrl.result?.isError === true);
  check('키 있음 + 인식불가 URL → 경고 문구 포함', badUrlText.includes('인식할 수 없는 유튜브 URL 형식'));

  child.kill();
}

console.log('\n=== 검증 ===');
let pass = true; for (const [n, ok] of checks) { console.log(ok ? '✅' : '❌', n); if (!ok) pass = false; }
console.log(pass ? '\n🎉 YOUTUBE TOOL TEST ALL PASS' : '\n⚠ 실패');
process.exit(pass ? 0 : 1);
