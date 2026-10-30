# 간편 기상 조회 운영 확인

`/api/weather/simple`에 Netlify Edge Function의 IP·도메인별 제한을 선언했습니다: 60초에 3회. 제한 응답은 HTTP 429이며, 화면은 응답이 HTML이어도 잠시 후 재시도 안내를 표시합니다. 기존 `netlify.toml` 빌드 설정은 변경하지 않았습니다.

이 제한은 클라이언트별 완화 수단이지 농업기상 API의 전체 사용량을 보장하는 전역 한도가 아닙니다. Netlify 공식 문서에 따르면 제한 반영에는 최대 10초의 지연이 있을 수 있습니다. 하나의 요청도 여러 관측 월을 조회하므로, 공급자 할당량 보호에는 서버 전체에서 공유되는 별도 예산 제한과 모니터링이 필요합니다.

배포 후 Netlify 빌드·배포 로그의 post-processing에서 `/api/weather/simple` 규칙이 실제 적용됐는지 확인해야 합니다. 유효하지 않은 규칙이 배포를 실패시키지 않을 수 있습니다. 미리보기에서 같은 클라이언트의 반복 요청에 429가 나오는지와 다른 경로가 정상인지 확인한 뒤 운영 반영합니다. 이 작업 환경에서는 Netlify Edge 런타임, 실제 배포 로그, 플랫폼 제한의 실효성, 전체 사이트 빌드를 검증하지 못했습니다.

출처: https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/
