# mcp-budget-server

광고 AE 견적서 정산용 **MCP 서버 (stdio)**. 견적서 데이터를 받아 **청구액 · 외주비 · 내수 · 내수율**을 계산합니다.

금액 표기를 똑똑하게 정규화합니다 — `"1.5억"`, `"3,000만"`, `"₩95,120,000"`, `"△100,000"`(회계식 음수), `"(100,000)"`(괄호 음수) 모두 정수(원)로 인식합니다.

> 파서 로직은 [`sns-dashboard`](https://github.com/haebojagu/sns-dashboard)의 `parse-amount.ts`를 독립 복사해 사용합니다.

---

## 요구 사항

- Node.js 18 이상
- (사용처) Claude Desktop 또는 MCP를 지원하는 클라이언트

## 설치

```bash
git clone https://github.com/<YOUR_ID>/mcp-budget-server
cd mcp-budget-server
npm install
npm run build      # tsc → dist/index.js 생성
```

> `dist/`는 git에 포함되지 않으므로 **클론 후 반드시 `npm run build`**를 실행해야 합니다.

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

## 동작 확인 (스모크 테스트)

```bash
npm run build && node smoke-test.mjs
```
stdio로 `initialize → tools/list → tools/call`을 수행해 계산 결과를 검증합니다.

## 기술 스택

- `@modelcontextprotocol/sdk` (stdio transport)
- `zod` (입력/출력 스키마)
- TypeScript (ESM, NodeNext)
