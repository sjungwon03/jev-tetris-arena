# JEV 테트리스 아레나

사용자와 JEV가 같은 블록 순서로 겨루는 40줄 스프린트 테트리스입니다. **React + strict TypeScript**로 게임 화면, 엔진, JEV API 어댑터와 선택 보정을 분리했습니다.

```sh
cd arena
npm ci
cp .env.example .env
# .env에 실제 API 주소·방식·모델·서버용 API 키 설정
npm run dev
```

[로컬 게임](http://localhost:3000)을 엽니다.

```sh
npm run typecheck
npm test
npm run build
```

## JEV 코드를 파악하려면

1. [공통 요청·응답 타입](arena/src/shared/contracts.ts)
2. [게임에서 모델을 요청하는 컨트롤러](arena/src/client/game/BattleController.ts)
3. [서버 API 라우트](arena/src/server/api.ts)
4. [테트리스 프롬프트와 후보 평가](arena/src/server/jev/planner.ts)
5. [실제 JEV 호출과 선택 검증](arena/src/server/jev/decisions.ts)
6. [선택 보정](arena/src/server/jev/selectionGuard.ts)
7. [React 통신 모니터](arena/src/client/components/JevMonitor.tsx)

[상세 문서](arena/README.md)에 실제 요청 흐름, 파일별 역할, API 계약, 모델 교체, 로그 재실행, 빌드·배포 구조를 설명했습니다.

키보드·모바일 조작, 홀드·고스트·다음 블록, JEV/LLM 교체형 프록시, 후보 평가·선택 보정, 원 요청/응답과 성능 로그 JSON 내보내기를 지원합니다. API 키는 서버에만 보관하며 `.env`, 로컬 진단 로그, 빌드 결과는 저장소에서 제외합니다.
