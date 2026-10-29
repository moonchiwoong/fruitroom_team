-- 측정 기록의 '측정한 사과 수'를 선택 항목으로 바꿉니다. (기존 값은 그대로 유지)
-- Supabase SQL Editor에서 한 번 실행하세요. 이미 비어 있을 수 있는 칸이면 아무 변화가 없습니다.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'observations'
               and column_name = 'sample_count' and is_nullable = 'NO') then
    alter table public.observations alter column sample_count drop not null;
  end if;
end $$;
