-- 주 산지에 '거창'을 추가합니다. (기존 값은 그대로 유지)
-- Supabase SQL Editor에 이 내용을 그대로 붙여 넣고 한 번 실행하세요.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.profiles'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%region%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.profiles add constraint profiles_region_check
  check (region in ('', 'geochang', 'cheongsong', 'jangsu', 'yeongju'));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, affiliation, region)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data->>'name', ''), 50),
    left(coalesce(new.raw_user_meta_data->>'affiliation', ''), 80),
    case when new.raw_user_meta_data->>'region' in ('geochang', 'cheongsong', 'jangsu', 'yeongju')
         then new.raw_user_meta_data->>'region' else '' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
