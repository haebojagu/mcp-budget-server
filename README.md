# mcp-budget-server

광고 AE 견적서 정산용 **MCP 서버 (stdio)**. 견적서 데이터를 받아 **청구액 · 외주비 · 내수 · 내수율**을 계산합니다.

금액 표기를 똑똑하게 정규화합니다 — `"1.5억"`, `"3,000만"`, `"₩95,120,000"`, `"△100,000"`(회계식 음수), `"(100,000)"`(괄호 음수) 모두 정수(원)로 인식합니다.

> 파서 로직은 [`sns-dashboard`](https://github.com/haebojagu/sns-dashboard)의 `parse-amount.ts`를 독립 복사해 사용합니다.

---

## 요구 사항

- Node.js 18 이상
- (사용처) Claude Desktop 또는 MCP를 지원하는 클라이언트
- (선택) `analyze_youtube_comments`의 유튜브 URL 자동 수집 기능을 쓰려면 **YouTube Data API v3 키**

## 설치

```bash
git clone https://github.com/<YOUR_ID>/mcp-budget-server
cd mcp-budget-server
npm install
npm run build      # tsc → dist/index.js 생성
```

> `dist/`는 git에 포함되지 않으므로 **클론 후 반드시 `npm run build`**를 실행해야 합니다.

---

## YouTube API 키 발급 및 설정 (선택)

`analyze_youtube_comments` 도구에서 댓글을 직접 붙여넣지 않고 **유튜브 URL로 자동 수집**하려면 API 키가 필요합니다. 키가 없어도 댓글을 수동으로 붙여넣는 기존 방식은 그대로 동작합니다.

### 1) 키 발급

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 생성(또는 선택)합니다.
2. **APIs & Services → Library**에서 **YouTube Data API v3**를 검색해 **사용 설정(Enable)**합니다.
3. **APIs & Services → Credentials → Create Credentials → API key**로 키를 발급받습니다.
4. (권장) 발급된 키를 **YouTube Data API v3로 제한**해 오남용을 방지합니다.

### 2) 키 설정 — 둘 중 하나

**방법 A: `.env` 파일** (로컬에서 `node dist/index.js`로 직접 실행할 때)

```bash
cp .env.example .env
# .env 파일을 열어 아래처럼 키 입력
# YOUTUBE_API_KEY=발급받은_키
```

**방법 B: Claude Desktop 설정의 `env` 필드** (Claude Desktop에 등록해 쓸 때 더 확실한 방법)

```json
{
  "mcpServers": {
    "budget": {
      "command": "node",
      "args": ["/Users/<YOU>/mcp-budget-server/dist/index.js"],
      "env": {
        "YOUTUBE_API_KEY": "발급받은_키"
      }
    }
  }
}
```

> `.env`는 `.gitignore`에 포함되어 있어 git에 커밋되지 않습니다. 절대 키를 코드에 하드코딩하거나 커밋하지 마세요.

키가 없는 상태에서 `youtube_urls`를 입력하면, 도구가 에러 대신 "`.env`에 키를 추가하거나 댓글을 직접 붙여넣어주세요" 안내 메시지를 반환합니다.

---

## Claude Desktop에 등록

### 1) 설정 파일 위치

| OS | 경로 |
|----|------|
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |

설정 파일을 여는 명령:

```bash
# macOS
open "~/Library/Application Support/Claude/claude_desktop_config.json"
```
```powershell
# Windows (PowerShell)
notepad "$env:APPDATA\Claude\claude_desktop_config.json"
```

### 2) `mcpServers`에 budget 서버 추가

`args`에는 **빌드된 `dist/index.js`의 절대 경로**를 넣습니다.

**macOS 예시**
```json
{
  "mcpServers": {
    "budget": {
      "command": "node",
      "args": ["/Users/<YOU>/mcp-budget-server/dist/index.js"]
    }
  }
}
```

**Windows 예시** (경로는 `\\` 또는 `/` 모두 가능)
```json
{
  "mcpServers": {
    "budget": {
      "command": "node",
      "args": ["C:\\Users\\<YOU>\\mcp-budget-server\\dist\\index.js"]
    }
  }
}
```

> 이미 `mcpServers`나 `preferences` 등 다른 키가 있다면 **`budget` 항목만 추가**하세요(기존 설정 유지).

### 3) Claude Desktop 재시작

설정 저장 후 Claude Desktop을 **완전히 종료(⌘Q / 트레이 종료) 후 재시작**해야 서버가 로드됩니다. 입력창의 🔌(도구) 아이콘에서 `budget`이 보이면 성공입니다.

---

## 사용법

### A. 엑셀 견적서 파일로 사용 (권장 흐름)

1. Claude Desktop 대화창에 **견적서 엑셀(.xlsx) 파일을 첨부**합니다.
2. 다음처럼 요청합니다:
   > "이 견적서에서 청구액과 외주비를 뽑아서 `analyze_estimate`로 내수율 계산해줘."
3. Claude가 엑셀 내용을 읽어 청구/외주 금액을 추출한 뒤 `analyze_estimate` 도구를 호출하고, **청구액·외주비·내수·내수율** 결과를 보여줍니다.

> 엑셀 파싱 자체는 Claude(모델)가 첨부 파일을 읽어 수행하고, 이 서버는 추출된 금액의 **정규화·합산·내수율 계산**을 담당합니다. `"1.5억"` 같은 표기가 섞여 있어도 정확히 계산됩니다.

### B. 도구를 직접 호출 (금액을 직접 입력)

```jsonc
// analyze_estimate 입력
{
  "billing": ["1.5억"],
  "outsource": ["3,000만", "₩20,000,000", { "label": "편집", "amount": "1,000만" }, "△5,000,000"]
}
```
결과: **청구액 ₩150,000,000 · 외주비 ₩55,000,000 · 내수 ₩95,000,000 · 내수율 63.3%**

---

## 도구 레퍼런스: `analyze_estimate`

**입력**

| 필드 | 타입 | 설명 |
|------|------|------|
| `billing` | `(string \| number \| {label?, amount})[]` | 청구액(클라이언트 청구) 항목들 |
| `outsource` | `(string \| number \| {label?, amount})[]` | 외주비(협력사 지급) 항목들 |

금액은 문자열 표기 가능: `"1.5억"`, `"3,000만"`, `"₩20,000,000"`, `"△5,000,000"`(음수).

**출력** (`structuredContent`)

| 필드 | 설명 |
|------|------|
| `billingTotal` | 청구액 합계 (원) |
| `outsourceTotal` | 외주비 합계 (원) |
| `naesu` | 내수 = 청구액 − 외주비 (원) |
| `naesuRate` | 내수율(%) = 내수 / 청구액 × 100 |
| `billingItems` / `outsourceItems` | 정규화된 항목 `{label, amount}` 목록 |

---

## 도구 레퍼런스: `analyze_youtube_comments`

유튜브 댓글을 정성 분석(감성 분포·대표 반응·키워드·인사이트)하기 위한 프롬프트 스캐폴딩 도구. 계산이 아니라 Claude가 분석을 작성하도록 구조화된 지침을 반환합니다.

**입력**

| 필드 | 타입 | 설명 |
|------|------|------|
| `comments` | `string` (선택) | 수동으로 붙여넣은 댓글 텍스트 (여러 줄) |
| `youtube_urls` | `string` (선택) | 자동 수집할 유튜브 영상 URL들, 줄바꿈으로 구분. `YOUTUBE_API_KEY` 필요 |
| `video_context` | `string` (선택) | 영상/캠페인 설명 |

`comments`와 `youtube_urls` 중 **최소 하나는 입력**해야 합니다. 둘 다 입력하면 두 출처의 댓글을 합쳐서 분석합니다.

**출력** (`structuredContent`)

| 필드 | 설명 |
|------|------|
| `comments` | 수동 입력 + 자동 수집을 합친 최종 댓글 텍스트 |
| `sources` | `youtube_urls`로 자동 수집에 성공한 영상 목록 (`url`, `videoId`, `commentCount`) |
| `warnings` | URL 인식 실패, API 키 미설정, 수집 실패 등 경고 메시지 |
| `structure` | 작성할 5개 섹션 (감성 분포 / 대표 긍정 반응 / 대표 부정·이슈 반응 / 핵심 키워드 / 종합 인사이트) |
| `instructions` | Claude가 따라야 할 작성 규칙 |

> YouTube Data API 호출은 `youtube_urls`가 주어지고 `YOUTUBE_API_KEY`가 설정된 경우에만 발생하며, 영상당 최대 100개 댓글(`commentThreads.list`)을 가져옵니다.

---

## 동작 확인 (스모크 테스트)

```bash
npm run build && node smoke-test.mjs           # analyze_estimate
node smoke-test-report.mjs                     # generate_campaign_report
node smoke-test-youtube.mjs                    # analyze_youtube_comments (키 없음/있음 케이스 포함)
```
stdio로 `initialize → tools/list → tools/call`을 수행해 각 도구의 동작을 검증합니다. `smoke-test-youtube.mjs`는 `YOUTUBE_API_KEY`가 없는 환경과 있는 환경을 각각 시뮬레이션해 안내 메시지·경고 처리를 확인합니다.

## 기술 스택

- `@modelcontextprotocol/sdk` (stdio transport)
- `zod` (입력/출력 스키마)
- `dotenv` (`.env`에서 `YOUTUBE_API_KEY` 로드)
- TypeScript (ESM, NodeNext)
