# 애플트랙 by FarmBridge — 사과 품질 예측·저장 관리

## 2026-10-23 업데이트: 애플트랙 UX/UI 개편
- 브랜드: 애플트랙 by FarmBridge · 슬로건 “초기 품질부터 저장 중 변화까지”. 메뉴: 홈 · 품질 변화 · 물량 관리 · 모델 정보.
- 품질 변화: 실측값 사용 / 예시로 체험, ①초기 품질 입력 → ②저장 조건 선택 → ③변화 확인, 저장 시작일(0일차)·분석 기준일·선택 날짜·경과일, 실측 점·계산 선·미래 점선, 한 문장 요약, 비교 기준 고정, 측정값과 비교, 입력 초안 자동 복구, 결과 내보내기(CSV), 경도 단위 변환(N↔kgf, 탐침 직경이 있을 때만 kgf/cm²).
- 계산 엔진 `lib/tracker.ts`(단위 테스트 62개), 저장 모델은 data/storage-quality-model.xlsx 수식을 보정 없이 사용하며 ‘시연용 계산 · 검증 미확인’으로 표시.
- 기상 기반 회귀식·산포도는 ‘모델 정보’의 상세 영역으로 이동(경도 N/mm는 실측 N과 다른 지표라 연결하지 않음).
- 환경·품질 기록 메뉴는 ‘물량 관리 → 물량 상세(측정 기록·온습도 이력·사진)’로 통합. 기존 기록은 그대로 보존.
- **배포 전에 한 번** `supabase/2026-10-23_appletrack_records.sql` 실행 필요.

## (이전 기록) FRUITROOM — Netlify + Supabase 팀 공유용 수정본

## 2026-10-22 업데이트: 첫 화면 랜딩 + 회원가입 + 개인 데이터
- 로그인 전 첫 화면: 스크롤하면 3D 사과가 회전하며 내려가는 소개 페이지, 마지막에 회원가입·로그인·비밀번호 찾기.
- 누구나 이메일로 가입. 각자 자기 물량·기록·사진·예측만 봅니다. 기존 물량은 '팀 공유'로 남아 팀원(team_members)끼리 계속 공유되고, 팀원은 새 물량을 등록할 때 '팀과 공유'를 고를 수 있습니다.
- 개인 맞춤: 내 정보(이름·소속·주 산지), 내 기본 기상값, 초기 품질 예측 기록 저장·불러오기·삭제.
- **배포 전에 한 번** `supabase/2026-10-22_personal_accounts.sql`을 Supabase SQL Editor에서 실행해야 합니다.
- Supabase → Authentication → Sign In / Providers에서 이메일 가입 허용, URL Configuration의 Site URL·Redirect URLs에 Netlify 주소를 넣어야 인증·비밀번호 재설정 메일 링크가 사이트로 돌아옵니다.

## 2026-10 업데이트: 웹사이트형 디자인 + 초기 품질 예측
- 상단 메뉴(홈 · 초기 품질 예측 · 물량 관리 · 환경·품질 기록 · 사진 비교 · 3D 시뮬레이션)와 홈 화면을 추가하고, 글자 대비·크기를 키웠습니다. 모바일에서는 메뉴 버튼으로 열립니다.
- **초기 품질 예측** 메뉴: 산지(청송·장수·영주)와 9월 강수량·5~6월/7~8월 적산온도·4월 최저기온을 넣으면 중량·횡경·경도·당도·산도를 회귀식으로 계산합니다. R², 평균 오차(RMSE), 학습 범위 이탈 경고, 요인별 영향, 실측 대비 산점도, CSV 저장을 제공합니다.
- 이어서 저온·1-MCP·CA 저장 방식별 감모율·경도·당도·산도 변화를 0~300일로 보여줍니다. 실측 초기값을 직접 넣을 수도 있습니다.
- 모델과 데이터: `lib/initial-quality.ts`(회귀식·저장식, 변수 이름도 여기서 수정), `data/initial-quality/*.csv`(산지별 200건), `data/`(원본 hwpx·xlsx). 예측은 브라우저에서 계산하며 Supabase 설정 변경은 필요 없습니다.

## 변경 사항
- Cloudflare/vinext 전용 실행을 일반 Next.js 실행으로 변경했습니다.
- Supabase 이메일/비밀번호 로그인 화면을 추가했습니다.
- 모든 데이터 API는 로그인 확인 및 team_members 등록 확인 후 사용자의 권한으로 요청합니다. 관리자 키를 사용하지 않습니다.
- 물량, 온습도, 품질 측정, 사진/CSV, 예측 기록을 공용 Supabase에 저장합니다.
- 사진은 비공개 버킷에 저장하고 60초 유효 서명 URL로 표시합니다.
- 기존 화면, 시뮬레이터, 데모 모드와 입력 검증은 유지했습니다.

## 확인 범위 / 한계
- 의존성 설치, TypeScript 검사, 프로덕션 빌드 성공을 확인했습니다.
- 실제 사용자 계정으로 로그인/업로드하거나 Netlify에 배포하는 통합 시험은 아직 하지 않았습니다.
- Supabase가 실제로 설정된 테이블/정책/버킷 이름과 일치해야 합니다.
- 기존 로컬/ChatGPT 사이트의 데이터는 자동으로 이전되지 않습니다.
- 타 팀원 변경은 페이지 새로고침으로 확인합니다. 실시간 동기화가 아닙니다.
- 환경 CSV는 500행씩 저장합니다. 중간 오류가 생기면 일부 행이 남을 수 있습니다. 동일 CSV를 재업로드하면 중복 행은 제외합니다. 원본 파일 저장과 DB 저장은 하나의 트랜잭션이 아닙니다.
- 현재 모든 허용된 팀원은 같은 기록을 읽고 변경할 권한을 갖습니다. 여러 팀을 분리하는 서비스가 아닙니다.
- 기본 Supabase 행 반환 한도 때문에 한 물량의 관측/사진 조회는 기본 1,000행까지입니다. 환경 기록은 페이지 조회로 20,000행까지 가져옵니다.
- 브라우저의 기존 세션이 복구되는 방식이며 장시간 로그인/만료 동작은 배포 후 확인해야 합니다.
- 무료 서비스 한도/미사용 일시정지 조건은 각 서비스 대시보드에서 확인하세요.

## 1. GitHub Desktop에 올리기
1. ZIP을 다른 폴더에 압축 해제합니다.
2. fruitroom-netlify 폴더 **안의 내용 전체**를 복사합니다. 폴더 자체를 복사하지 마세요.
3. GitHub Desktop의 Show in Explorer로 연 fruitroom_team 폴더 안에 붙여넣습니다. 기존 .git 폴더는 유지하세요.
4. 저장소 루트에서 package.json, app, lib, netlify.toml이 바로 보여야 합니다.
5. GitHub Desktop Changes에서 파일 목록을 확인합니다.
6. Summary에 `Supabase 팀 공유 버전` 입력 -> Commit to main -> Publish branch 또는 Push origin.
7. node_modules, .next, .env.local, 비밀키는 올리지 않습니다.

## 2. Netlify 연결
1. Add new project -> Import an existing project -> GitHub.
2. 필요한 저장소 fruitroom_team에만 접근 승인하고 선택합니다.
3. Base directory는 비워 둡니다. Build command는 npm run build, Publish directory는 .next입니다.
4. 배포 설정의 Environment variables에 아래 3개를 추가합니다. 빌드와 서버 실행 모두에서 사용할 수 있게 설정합니다.

NEXT_PUBLIC_SUPABASE_URL=https://epofoisfqutebtozadps.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_N0FFkEyvld227XvH04hEUw_XYglnRJq
SUPABASE_STORAGE_BUCKET=fruitroom_files

5. Deploy를 실행합니다. 이미 배포했다면 변수 설정 후 다시 배포하세요.
6. Next.js 지원은 Netlify의 프레임워크 자동 감지를 사용합니다. 소스 ZIP을 정적 파일 드롭 영역에 올리는 방식이 아닙니다.
7. Supabase Authentication의 URL Configuration에서 Site URL을 실제 Netlify HTTPS 주소로 설정합니다. 이후 초대메일/비밀번호 재설정 등 리다이렉트를 쓰려면 해당 Redirect URLs도 등록합니다.

## 3. 팀원 계정
Supabase Authentication -> Users에서 관리자 직접 생성 계정을 이용합니다.
계정 비밀번호는 채팅이나 GitHub에 넣지 마세요. 실제 개인 사용자 초대/비밀번호 설정 흐름은 배포 후 따로 구성하는 편이 안전합니다.
각 계정 UID를 SQL Editor에서 등록합니다:

```sql
INSERT INTO public.team_members (user_id)
VALUES ('추가할-팀원-UID')
ON CONFLICT (user_id) DO NOTHING;
```

team_members 등록 없이 단순 가입만으로 접근할 수 없습니다. 외부 가입을 원하지 않으면 Supabase Authentication에서 신규 공개 가입도 비활성화하세요.

## 4. 배포 후 필수 테스트
- 비로그인: 로그인 화면 표시, API 직접 접근 차단.
- 팀원 계정: 로그인 후 물량 추가, 새로고침 후 보존.
- 별도 팀원 계정/다른 브라우저: 같은 물량/관측/사진 표시.
- 환경 CSV 업로드, 중복 재업로드, 사진 업로드 및 표시.
- 팀원 목록에 없는 계정: 기록 접근 차단.
- 본인 컴퓨터를 끈 뒤 휴대폰에서 Netlify 주소 접속 확인.

## 로컬 실행
Node.js 22.13 이상 권장. .env.example을 .env.local로 복사합니다.

```sh
npm install
npm run dev
```

터미널이 표시하는 주소로 접속합니다. 이 수정본은 pnpm dev 대신 npm run dev를 사용합니다.
