-- ═══════════════════════════════════════════════════════════════════════
-- 애플트랙 기록 구조 확장 (2026-10-23)
-- Supabase 대시보드 → SQL Editor → 새 쿼리에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전하며, 기존 행과 값은 바꾸거나 지우지 않습니다.
--
--  · 물량: 저장 시작일, 초기 측정일·표본 수, 세부 정보(측정 조건·1-MCP·CA·추적 표본)
--  · 측정 기록: 산도, 추적 표본 평균 중량, 측정 조건
--  · 물량 등록 때 이름·품종·입고일 외 항목은 비워 둘 수 있게 필수 조건 완화
-- ═══════════════════════════════════════════════════════════════════════

alter table public.lots add column if not exists storage_start_date date;
alter table public.lots add column if not exists initial_measured_on date;
alter table public.lots add column if not exists initial_sample_count integer check (initial_sample_count is null or initial_sample_count > 0);
alter table public.lots add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.observations add column if not exists acidity numeric;
alter table public.observations add column if not exists tracked_weight numeric;
alter table public.observations add column if not exists details jsonb not null default '{}'::jsonb;

-- 측정하지 않았거나 해당 없는 항목은 비워 둘 수 있게 합니다. (값이 있는 기존 행은 그대로)
do $$
declare c text;
begin
  foreach c in array array['harvest_date', 'location', 'sensor_id', 'quantity', 'packaging']
  loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'lots' and column_name = c and is_nullable = 'NO') then
      execute format('alter table public.lots alter column %I drop not null', c);
    end if;
  end loop;
end $$;

-- 결과 확인용: 7줄(lots 4칸 + observations 3칸)이 나오면 정상입니다.
select table_name, column_name from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'lots' and column_name in ('storage_start_date', 'initial_measured_on', 'initial_sample_count', 'details'))
     or (table_name = 'observations' and column_name in ('acidity', 'tracked_weight', 'details')))
 order by table_name, column_name;
