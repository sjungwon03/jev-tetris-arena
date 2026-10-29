# JEV 테트리스 아레나 — React + TypeScript

사용자와 JEV가 같은 블록 순서로 40줄 스프린트를 겨룹니다. 화면은 React, 게임 엔진·서버 하네스·API 계약은 strict TypeScript로 작성했습니다.

## 실행과 검증

Node.js 22 이상이 필요합니다.

```sh
npm ci
cp .env.example .env
# 서버용 API 키와 연결 방식 설정
npm run dev
```

[로컬 게임](http://localhost:3000)을 엽니다. Vite가 React/TSX를 처리하고 같은 Node 서버가 `/api/*` 프록시를 실행합니다. API 키는 브라우저로 전달하지 않습니다.

```sh
npm run typecheck
npm test
npm run build
npm run benchmark
```

`dist/client/`는 React 번들, `dist/server/index.js`는 정적 파일과 모델 프록시를 함께 제공하는 Worker입니다. 빌드는 esbuild가 TypeScript 모듈의 import 관계를 따라 번들링하며, 소스 문자열을 이어 붙이거나 import를 정규식으로 제거하지 않습니다.

## JEV 사용 코드를 읽는 순서

| 순서 | 파일 | 역할 |
| --- | --- | --- |
| 1 | `src/shared/contracts.ts` | 보드·배치·요청·응답·보정·진단 로그의 공통 타입 |
| 2 | `src/client/game/BattleController.ts` | 현재 보드를 복사하고 모델 요청을 시작하는 `plan()`, 응답을 실행하는 `stepAi()` |
| 3 | `src/client/api.ts` | 브라우저가 같은 출처의 `POST /api/move`를 호출하는 타입 있는 클라이언트 |
| 4 | `src/server/api.ts` | 입력 검사, 어댑터 선택, 진단 이벤트, 응답 조립 |
| 5 | `src/server/jev/planner.ts` | 테트리스 요령, 후보 지표, 다음 블록 예측, 평가 순위, 실제 JEV 프롬프트 |
| 6 | `src/server/jev/decisions.ts` | `state/question/options` 요청, 인증, JEV 응답 검증, 토큰 한도 재분할 |
| 7 | `src/server/jev/selectionGuard.ts` | 모델 원래 선택과 실제 적용할 선택을 구분하는 선택 보정 |
| 8 | `src/client/components/JevMonitor.tsx` | 원 요청·응답·확률·모델 원래 선택·보정 결과 표시 |

`src/server/jev/openai.ts`는 선택 가능한 Chat Completions / Responses 어댑터입니다. 실제 JEV 결정 API와 별도 파일이므로 두 연결 방식을 혼동하지 않고 읽을 수 있습니다.

### 실제 요청 흐름

```text
React 화면의 배틀 시작
  → BattleController.plan(): { board, piece, next, assist }
  → modelApi.move(): POST /api/move
  → api(): 보드·출처·요청 크기 검증
  → rankPlans(): 전체 후보와 다음 블록 결과 계산
  → runJev(): 상위 후보를 POST {JEV_BASE_URL}/decisions로 전송
  → parseJevDecision(): prediction / prediction_index 대조
  → guardSelection(): 보정 여부와 원래 선택 보존
  → MoveResponse.trace: 통신·모델 식별·보정·시간 정보
  → BattleController: 오래된 응답 폐기, 배치 실행
  → React: 보드·통신 패널·성능 로그 갱신
```

JEV 네이티브 호출 예시는 `decisions.ts`의 `round()`에 있습니다. 인증 헤더는 이 서버 모듈에서만 만듭니다. 네이티브 API에 `model` 필드를 추가하지 않습니다.

```ts
// 실제 요청 타입: src/shared/contracts.ts
interface DecisionRequest {
  state: string;
  question: string;
  options: string[];
}
```

JEV의 반환값은 코드나 자유로운 지시로 실행하지 않습니다. `prediction`이 전송한 옵션 중 하나인지 확인하고, `prediction_index`가 있다면 동일한 옵션을 가리키는지 확인한 뒤 원래 `Move`에 매핑합니다.

## 구성

```text
src/
  domain/tetris.ts               순수 게임 규칙·배치 시뮬레이션
  shared/contracts.ts           브라우저/서버 공통 타입
  server/
    api.ts                      HTTP 라우트와 어댑터 조합
    http.ts                     안전한 오류·진단·응답 유틸리티
    dev.ts                      로컬 Node + Vite 개발 서버
    worker.ts                   배포용 Worker 진입점
    jev/
      planner.ts                프롬프트·후보 평가·다음 블록 예측
      decisions.ts              JEV 전용 API 클라이언트
      selectionGuard.ts         선택 보정
      openai.ts                 교체형 LLM 어댑터
  client/
    App.tsx                     React 화면과 사용자 이벤트
    api.ts                      같은 출처의 프록시 호출
    game/BattleController.ts    게임 루프·취소·로그 상태
    components/                 보드·플레이어·통신·진단 패널
```

컨트롤러는 React 외부의 게임 상태를 관리하고 `useSyncExternalStore`로 화면에 연결합니다. 컴포넌트는 `document.getElementById`로 내용을 수정하지 않습니다. Canvas 그리기와 파일 다운로드만 브라우저 API를 사용합니다. 통신·성능 패널은 메모이제이션해 매 프레임 큰 JSON을 다시 직렬화하지 않습니다.

## 서버 환경변수

| 이름 | 용도 |
| --- | --- |
| `JEV_BASE_URL` | 실제 JEV: `https://jev.sanhouse.kr/v1` |
| `JEV_API_STYLE` | `decisions` / `chat` / `responses` |
| `JEV_MODEL` | 네이티브 표시 이름 또는 LLM의 정확한 모델 ID |
| `JEV_API_KEY` | 서버 전용 Bearer 키 |
| `JEV_UPSTREAM_MODEL_ID` | 알고 있는 실제 모델 ID를 운영자가 명시하는 선택 설정 |
| `JEV_CANDIDATE_LIMIT` | 네이티브 후보 개수, 기본 4. `0`은 전체 후보 |
| `PORT` | 로컬 개발 포트, 기본 3000 |

`.env.example`은 설정 예시일 뿐 현재 운영값의 증거가 아닙니다. 운영값은 Sites 런타임 설정이며 배포가 이를 반영합니다. 키는 `.env` 또는 런타임 비밀 환경변수에만 넣고, Git과 브라우저에 넣지 않습니다.

## 실력 보정과 진단

‘실력 보정’이 켜진 게임은 요청의 `assist: true`로 명시됩니다. 동률 선택은 그대로 두고, 평가가 낮은 선택은 하네스 1위로 보정합니다. 모델의 원래 응답·선택·확률을 변경하지 않고 별도 `selectionGuard`와 이벤트에 적용 결과를 남깁니다. 보정 모드 성적은 JEV 모델 단독 성적과 구분해야 합니다.

모델 ID는 응답에서 제공될 때만 `api_response`, 운영자가 지정하면 `operator_configuration`, 둘 다 없으면 `unreported`로 기록합니다. 입력 버전·요청 ID·턴·호출 단계·실패·타임아웃·현재 보드·실행 결과를 보존합니다.

브라우저는 최근 최대 120턴(약 1.5MB)을 localStorage에 저장합니다. 화면의 **JSON 로그 다운로드**로 받을 수 있습니다. 서버는 같은 요청 ID를 가진 `jev-performance` JSON 로그를 표준 출력에 남깁니다. 인증키·인증 헤더·알 수 없는 업스트림 오류 본문은 기록하지 않습니다.

JEV 입력 제한: question 500자, state 3,000자, 중복 없는 옵션 2~20개, 옵션당 200자. 추가 토큰 제한이 발생하면 해당 후보 집합을 나눠 평가합니다. 요청 전체 20초, 브라우저 대기 22초 제한을 유지합니다.

## 재실행과 테스트

```sh
npm run replay -- --input your-log.json --output replay-dry-run.json
# 실행 대상이 있을 때만 실제 호출. 키는 환경변수로 주입.
JEV_REPLAY_URL=https://comparison.example/v1/decisions npm run replay -- --input your-log.json --output replay-results.json
```

재실행은 로그의 state/question/options를 그대로 보냅니다. 실험 이름은 실제 모델 ID의 확인 근거로 사용하지 않습니다. 예선·최종 요청을 고정 재생하는 도구이며 전체 게임 평가와 구분해야 합니다.

테스트는 게임 규칙과 전체 JEV 경로의 기존 회귀 검증, 타입 있는 컨트롤러의 응답 취소·오류·로그 복원, React 화면의 서버 렌더링을 포함합니다. DOM 문자열을 흉내 내는 VM 기반 화면 테스트는 제거했습니다. `benchmark-planner.mjs`의 한 판 시뮬레이션은 모델 호출 없이 하네스 선택을 검증하므로 실제 JEV 승률로 해석하면 안 됩니다.
