# 애플트랙 (AppleTrack) by FarmBridge

사과의 **처음 품질**과 **저장 중 변화**를 계산해 보여 주고, 직접 잰 값과 비교·기록하는 웹 서비스입니다.
원예특작과학원 멘토링을 바탕으로 5조 팜브릿지가 만들었습니다.

- 사이트: https://trackap.netlify.app
- 계산은 **시연용**이며 정확도가 아직 검증되지 않았습니다. 출하·안전 여부를 판정하지 않습니다.

## 주요 기능

| 구분 | 기능 |
| --- | --- |
| 새 사과 등록 | 품종 → 생산지 → 수확일 → 보관 조건 → 처음 품질(날씨로 자동 추정 / 직접 잰 값) 5단계 |
| 처음 품질 추정 | 수확한 해 4~9월 농업기상 관측자료로 산지별 회귀식 계산(홍로: 거창, 후지: 청송·장수·영주) |
| 저장 중 변화 | 단단함·당도·산도·무게 감소를 저장 일수별로 계산, 쉬운 말(“처음보다 약 9% 물러짐”)로 표시 |
| 측정 비교 | 직접 잰 값을 넣으면 그 값부터 다시 계산, 그래프에 처음 예측·실측·다시 계산한 선을 함께 표시, 기록별 예측 대 실제 차이 |
| 그래프·3D | 항목별 그래프, 수확 때 ↔ 고른 날 3D 사과 나란히 비교(무게 감소만 반영한 설명용) |
| 농가 편의 | 글자 크게, 휴대폰 홈 화면 추가(PWA), N↔kg 환산, 상자 수 환산, 내 단단함 기준 도달 시기, 출하 완료 정리, CSV 내려받기 |
| 비회원 체험 | `/try`: 예시 사과 보기, 내 사과로 해 보기(저장 없이 결과 확인) |
| 계정 | 아이디·비밀번호 가입, 비밀번호 변경, 회원 탈퇴, 개인정보처리방침(`/privacy`)·이용약관(`/terms`) |

## 계산 근거와 적용 범위

| 품종 | 처음 품질(날씨) | 저장 중 변화 | 계산 범위 |
| --- | --- | --- | --- |
| 홍로 | 거창 회귀식 | 팀 엑셀 근사식(유진기 외 2018, 거창 0℃·4℃ 저장 연구 기반) | 일반 저온·1-MCP 미처리·0℃/4℃, 0~120일 |
| 후지 | 청송·장수·영주 회귀식 | 팀 엑셀 식(일반 저온·1-MCP·CA) | CA+1-MCP 처리는 준비 중, 0~300일 표시 |

- 날씨 변수(작성자 정의): 4월 일최저기온 평균, 5~6월·7~8월 (일평균기온 − 5℃) 합, 9월 1~30일 강수량 합.
- 날씨 자료: 농촌진흥청 국립농업과학원 농업기상 관측(농업날씨365), 공공데이터포털 API. 빠진 날이 있거나 기간이 끝나지 않으면 값을 채우지 않고 계산하지 않습니다.
- 홍로는 9월 중 수확하므로 9월 전체 강수량에 수확 이후 비가 포함됩니다. 현재 값은 지난 관측자료를 이용한 참고 추정이며, 수확 전 기간으로 다시 만든 식으로 보완할 예정입니다.
- 색 변화·저장 장해는 예측하지 않습니다.
- 식·계수·출처 대조는 [docs/model-sources.md](docs/model-sources.md), 원자료는 `data/` 폴더에 있습니다.

## 기술 구성

- Next.js 16, React 19, TypeScript
- Supabase(인증·데이터베이스·파일 저장, 서울 리전), Netlify 배포
- three.js(3D), GitHub Actions(자동 테스트)

```
app/            화면(내 사과, 체험 /try, 처리방침 /privacy, 약관 /terms)과 API 경로
components/     화면 구성 요소(my-apples, new-apple, apple-graph, lot-preview 등)
lib/            계산 엔진(quality-models, initial-quality, hongro, lot-predict, rda-weather)
supabase/       데이터베이스 SQL(날짜순)
data/           회귀식·저장식 원자료와 근거 문서
docs/           모델 출처(model-sources.md), archive/는 이전 작업 기록
tests/          단위 테스트, tests/browser는 브라우저 테스트
```

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```sh
npm ci
npm run dev
```

`.env.local`에 아래 값을 넣습니다. **비밀키는 Git에 올리지 마세요.**

```dotenv
NEXT_PUBLIC_SUPABASE_URL=<Supabase 프로젝트 URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
SUPABASE_STORAGE_BUCKET=fruitroom_files
RDA_SERVICE_KEY=<공공데이터포털 농업기상 인증키, 서버에서만 사용>
```

AI 도우미 코드는 남아 있지만 `AI_*` 환경변수를 넣지 않아 꺼져 있습니다.

### 데이터베이스

새 Supabase 프로젝트라면 `supabase/` 폴더의 SQL을 파일 이름(날짜) 순서대로 실행합니다.
가입은 아이디 방식이므로 Supabase Authentication → Email의 **Confirm email을 꺼 두어야** 합니다.

## 검증

```sh
npm run typecheck
npm test
npm run build
```

GitHub에 올리면 `.github/workflows/test.yml`이 테스트와 타입 검사를 자동으로 실행합니다.

## 팀

5조 팜브릿지 · 문의 mooncw@jbnu.ac.kr
