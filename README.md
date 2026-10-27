# 애플트랙 by FarmBridge

사과 초기 품질·저장 중 변화 조회와 개인/팀 공유 물량 관리 웹앱입니다. Next.js, Supabase를 사용합니다.

## 2026-10-26 수정본

업로드된 `fruitroom_team-main(3).zip`에 품종별 저장 모델과 GLB 외관 연결을 반영했습니다. 운영 Netlify 사이트는 이 ZIP만으로 변경되지 않습니다. 기존 배포 절차로 소스를 반영해야 합니다.

- 공통 엔진 `lib/quality-models.ts`가 품종·저장 방식·온도·1-MCP·항목·표시 기간을 선택하고 값/null, 모델·버전·출처·검증 상태·불가 사유를 반환합니다.
- 홍로 일반 저온 0℃·4℃는 제공 엑셀의 경도·당도·산도 근사식을 0~120일에 제공합니다. CA·1-MCP·중간 온도·121일 이후는 계산하지 않습니다.
- 감모율은 실측/모델/후지 기반 참고 추정을 구분합니다. 모델 감모율은 초기 중량 없이 계산합니다. 홍로의 후지 참고식은 명시적 선택 시에만 0~120일에 제공합니다.
- 초기·최근 측정값은 저장 시작일 시간축에서 변화량 또는 비율로 연결합니다. 산지 계수와 센서 온도 보정은 추가하지 않았습니다.
- 숫자·그래프·CSV·근거 화면·3D·읽기 전용 AI 계산은 같은 모델 정의를 사용합니다. 전환 비교는 검증되지 않은 조건 변경 시나리오로 표시합니다.
- 최신 후지 엑셀 E6의 1-MCP 경도 유지식 `F(t)=F0`를 별도 버전으로 사용합니다. 이전 이차식과 최신 파일 C6 분류 불일치는 근거 화면과 변경 내역에 남겼습니다.
- `public/models/apple-web.glb`는 제공받은 공통 설명용 사과 모델입니다(색상·거칠기 텍스처만 JPEG로 재압축, 형상 그대로). 실제 메시 좌표를 변형하고, 감모율→체적→길이의 설명용 가정과 별도 주름 설정을 사용합니다. 후지 화면에서는 공통 설명용 외형임을 밝힙니다.
- 로그인·물량·관측·사진·센서 기록·기상 회귀 상세 기능은 유지했습니다. 기존 JSON details에 온도·참고 추정 선택을 추가하므로 별도 DB 열 마이그레이션은 필요하지 않습니다.

수정 파일·검증·남은 한계는 [이번 변경·검증 보고서](docs/2026-10-26-change-report.md), 원자료 대조는 [모델 출처](docs/model-sources.md)를 확인하세요. 기존 `docs/verification.md`, `docs/hongro-implementation.md`, `docs/hongro-sources.md`는 이전 구현의 기록이며 현재 동작은 이번 보고서가 우선합니다.

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
