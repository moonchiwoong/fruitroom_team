# 애플트랙 by FarmBridge

사과 초기 품질·저장 중 변화 조회와 개인/팀 공유 물량 관리 웹앱입니다. Next.js, Supabase를 사용합니다.

## 이번 수정본의 상태

통합 UX/UI·AI 요구사항을 제공받은 `moonchiwoong/fruitroom_team` 소스에 적용했습니다. 기준 GitHub `main` 커밋은 `08ac94953e9916c7af6c0e1b70e7b4de8a6c91df`이며 업로드 ZIP의 커밋과 일치합니다. **이 문서는 2026-10-23 로컬 검증 시점의 기록입니다. 당시 운영 Netlify 배포와의 연결은 확인하지 못했으며, GitHub 반영 및 운영 배포 결과는 별도로 확인해야 합니다.**

현재 결과·검증 범위는 [docs/verification.md](docs/verification.md), AI 설정과 복구 방법은 [docs/ai-operations.md](docs/ai-operations.md)를 확인하세요. 과거 README에 적힌 ‘62개 테스트’ 파일은 제공 ZIP에 없으므로 이번 검증 근거로 사용하지 않았습니다.

## 화면과 데이터

- 상단 메뉴: 홈 / 품질 예측 / 물량 관리. 내 정보는 별도 계정 메뉴입니다.
- 홈에서 실측 입력·예시 체험·최근 물량 선택을 시작합니다. 품질 예측은 기존 물량의 결과를 우선 보여주고 입력과 조건 비교를 펼칩니다.
- 모델 정보는 결과의 ‘계산 근거·적용 범위’, 푸터의 ‘전체 모델 정보’, 기존 `#model` 주소에서 접근합니다. 3D 외관 예시는 하단에 접혀 있습니다.
- 로그인·개인/팀 공유 권한·측정·사진·환경 CSV·초안·내보내기·기준 고정 기능을 유지했습니다. 계정 변경 때 화면 상태를 초기화합니다.
- 저장 모델 식·계수는 유지했습니다. **시연용 계산·검증 미확인**이며 표시 가능 기간은 검증된 적용 기간이 아닙니다. 품종 보정과 실측 온습도 이력은 현재 저장 계산식에 반영되지 않습니다.
- 실제 감모율은 동일 추적 표본 ID, 초기/후속 중량과 측정일이 있어야 표시됩니다. 과거 기록에 표본 ID가 없으면 임의로 연결하지 않습니다.
- N↔kgf 환산을 표시용으로 유지합니다. 직경만으로 압력 환산을 제공하지 않습니다. 초기 측정일이 분석 기준일 이후면 계산을 차단합니다.
- AI는 조회·설명 전용입니다. 실제 SDK MCP 도구 7개를 사용하며 기록 변경 도구는 없습니다. 공급자·모델·키·가격·예산 설정 전에는 사용할 수 없다고 표시합니다.

## 로컬 실행

Node.js 22.13 이상을 사용합니다.

```sh
npm ci
npm run dev
```

기존 Supabase 프로젝트의 설정을 `.env.local`에 넣으세요. 비밀키를 Git에 넣지 마세요.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=<기존 Supabase 프로젝트 URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<기존 publishable key>
SUPABASE_STORAGE_BUCKET=fruitroom_files
```

기존 DB 구성 여부를 먼저 확인하세요. 기존 마이그레이션 `supabase/2026-10-22_personal_accounts.sql`, `supabase/2026-10-23_appletrack_records.sql`은 이미 적용되었다면 다시 실행할 필요가 없습니다. 이번 AI 전용 마이그레이션은 `supabase/2026-10-23_ai_budget.sql`이며 기존 고객 기록 테이블·정책을 변경하지 않습니다. 적용 후에도 기본값은 AI 비활성화입니다.

개인 계정은 본인 소유 물량에 접근하고 `team_members`에 등록된 계정만 팀 공유 물량에 접근합니다. 여러 팀을 구분하는 서비스로 변경한 것은 아닙니다. Supabase Authentication의 Site URL과 Redirect URLs는 실제 배포 주소에 맞춰 유지하세요.

## 검증 명령

```sh
npm run typecheck
npm test
npm run build
```

브라우저 fixture 검증은 `npm run test:ui`이며 Playwright/Chromium 준비가 필요합니다. [tests/browser/README.md](tests/browser/README.md)를 참고하세요. 실제 고객 데이터와 외부 AI 호출을 사용하지 않습니다. SQL fixture 검증의 별도 실행법은 `docs/verification.md`에 기록합니다.

## 운영 반영 시

1. 현재 Netlify 프로젝트의 연결 저장소·브랜치·배포 커밋을 확인합니다.
2. 이 변경을 기존 저장소에서 검토·커밋하고 배포 미리보기에서 확인합니다.
3. 기존 환경변수와 필요한 DB 마이그레이션 적용 여부를 확인합니다. AI 공급자 선택과 비용 한도 설정은 별도입니다.
4. 실제 테스트 계정으로 개인/공유 권한·저장·CSV·사진·인증 복구를 확인한 뒤 운영 반영합니다.

기존 `netlify.toml`의 빌드 명령은 `npm run build`, 출력은 `.next`입니다. 소스 ZIP을 정적 사이트 업로드 영역에 올리는 배포 방식은 사용하지 않습니다.

환경 CSV는 기존처럼 500행씩 저장하므로 오류 시 일부 행이 남을 수 있습니다. 관측·사진 조회는 기존 기본 1,000행, 환경 기록은 20,000행 상한이 있으며 AI는 일부 조회임을 표시합니다. 타 사용자 변경은 자동 실시간 동기화되지 않습니다.
