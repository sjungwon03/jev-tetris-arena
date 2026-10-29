# JEV 테트리스 아레나

사용자와 JEV가 같은 블록 순서로 겨루는 40줄 스프린트 테트리스입니다.

- 키보드·모바일 조작, 홀드·고스트·다음 블록 표시
- JEV 결정 API와 OpenAI 호환 LLM을 교체할 수 있는 서버 프록시
- 후보별 배치 결과·다음 블록 예측·선택 보정
- 모델 요청·응답·원래 선택·보정 결과·성능 로그 표시 및 JSON 내보내기

## 로컬 실행

Node.js 22 이상이 필요하며 별도 패키지 설치 없이 실행합니다.

```sh
cd arena
cp .env.example .env
# .env에 실제 API 주소·방식·모델·API 키 설정
node server.mjs
```

브라우저에서 http://localhost:3000 으로 접속합니다. API 키는 서버 환경변수에만 넣습니다. `.env`, 로컬 진단 로그, 빌드 결과는 저장소에서 제외됩니다.

## 검증

```sh
cd arena
node test/game.test.mjs
node test/monitor.test.mjs
node test/replay.test.mjs
node scripts/build.mjs
node --check dist/server/index.js
```

배치 평가와 보정의 한 판 검증은 `node scripts/benchmark-planner.mjs`로 실행합니다. 결과 저장 경로인 `arena/diagnostics/`가 없으면 먼저 만들어 주세요. 이 실험은 로컬 시뮬레이션이며 실제 JEV 승률과 구분해야 합니다.

프록시 설정, API 계약, 모델 교체, 로그 재실행, 배포 이력은 [상세 문서](arena/README.md)를 참고하세요. `arena/.openai/hosting.json`은 기존 Sites 배포 식별자를 포함합니다. 별도 사이트로 배포할 때는 해당 플랫폼 절차로 새 프로젝트를 연결하세요.
