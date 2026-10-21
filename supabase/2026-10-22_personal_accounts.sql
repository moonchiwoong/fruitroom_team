-- ═══════════════════════════════════════════════════════════════════════
-- FRUITROOM 개인 계정 전환 (2026-10-22)
-- Supabase 대시보드 → SQL Editor → 새 쿼리에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다.
--
-- 결과
--  · 누구나 회원가입 가능. 각자 자기 물량·기록·사진·예측만 봅니다.
--  · 기존 물량은 '팀 공유'로 표시되어 team_members 팀원끼리 계속 공유됩니다.
--  · 팀원은 새 물량을 등록할 때 '팀과 공유'를 고를 수 있습니다.
--  · 회원 프로필(이름·소속·주 산지·기본 기상값)과 초기 품질 예측 기록을 저장합니다.
-- ═══════════════════════════════════════════════════════════════════════

-- 1) 팀원 여부 확인 함수 (정책 안에서 사용)
create or replace function public.is_team_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where user_id = auth.uid());
$$;
revoke all on function public.is_team_member() from public;
grant execute on function public.is_team_member() to authenticated;

-- 2) 회원 프로필
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 50),
  affiliation text not null default '' check (char_length(affiliation) <= 80),
  region text not null default '' check (region in ('', 'cheongsong', 'jangsu', 'yeongju')),
  default_inputs jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- 가입하면 프로필 자동 생성 (가입 화면에서 받은 이름·소속·산지 사용)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, affiliation, region)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data->>'name', ''), 50),
    left(coalesce(new.raw_user_meta_data->>'affiliation', ''), 80),
    case when new.raw_user_meta_data->>'region' in ('cheongsong', 'jangsu', 'yeongju')
         then new.raw_user_meta_data->>'region' else '' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
-- 이미 있는 계정(기존 팀원)에도 빈 프로필 생성
insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;

-- 3) 초기 품질 예측 기록
create table if not exists public.quality_predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  region text not null check (region in ('cheongsong', 'jangsu', 'yeongju')),
  title text not null default '' check (char_length(title) <= 80),
  inputs jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists quality_predictions_user_created on public.quality_predictions (user_id, created_at desc);
alter table public.quality_predictions enable row level security;
drop policy if exists "qp_select_own" on public.quality_predictions;
drop policy if exists "qp_insert_own" on public.quality_predictions;
drop policy if exists "qp_delete_own" on public.quality_predictions;
create policy "qp_select_own" on public.quality_predictions for select to authenticated using (user_id = auth.uid());
create policy "qp_insert_own" on public.quality_predictions for insert to authenticated with check (user_id = auth.uid());
create policy "qp_delete_own" on public.quality_predictions for delete to authenticated using (user_id = auth.uid());

-- 4) 물량 소유자 / 팀 공유 표시
alter table public.lots add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.lots add column if not exists team_shared boolean not null default false;
-- 기존 물량(소유자 없음)은 팀 공유로 유지
update public.lots set team_shared = true where owner_id is null and team_shared = false;
alter table public.lots alter column owner_id set default auth.uid();

-- 5) 기존 정책을 지우고 개인/팀 정책으로 교체
do $$
declare p record;
begin
  for p in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in ('lots', 'environment', 'observations', 'files', 'predictions')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

alter table public.lots enable row level security;
alter table public.environment enable row level security;
alter table public.observations enable row level security;
alter table public.files enable row level security;
alter table public.predictions enable row level security;

create policy "lots_select" on public.lots for select to authenticated
  using (owner_id = auth.uid() or (team_shared and public.is_team_member()));
create policy "lots_insert" on public.lots for insert to authenticated
  with check (owner_id = auth.uid() and (not team_shared or public.is_team_member()));
create policy "lots_update" on public.lots for update to authenticated
  using (owner_id = auth.uid() or (team_shared and public.is_team_member()))
  with check ((owner_id = auth.uid() and (not team_shared or public.is_team_member())) or (team_shared and public.is_team_member()));
create policy "lots_delete" on public.lots for delete to authenticated
  using (owner_id = auth.uid() or (team_shared and public.is_team_member()));

-- 하위 기록은 '볼 수 있는 물량'에 딸린 것만 읽고 쓸 수 있습니다.
create policy "environment_by_lot" on public.environment for all to authenticated
  using (exists (select 1 from public.lots l where l.id = environment.lot_id))
  with check (exists (select 1 from public.lots l where l.id = environment.lot_id));
create policy "observations_by_lot" on public.observations for all to authenticated
  using (exists (select 1 from public.lots l where l.id = observations.lot_id))
  with check (exists (select 1 from public.lots l where l.id = observations.lot_id));
create policy "files_by_lot" on public.files for all to authenticated
  using (exists (select 1 from public.lots l where l.id = files.lot_id))
  with check (exists (select 1 from public.lots l where l.id = files.lot_id));
create policy "predictions_by_lot" on public.predictions for all to authenticated
  using (exists (select 1 from public.lots l where l.id = predictions.lot_id))
  with check (exists (select 1 from public.lots l where l.id = predictions.lot_id));

-- 6) 사진·CSV 저장소: 경로 lots/<물량ID>/... 의 물량을 볼 수 있을 때만 접근
do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and (coalesce(qual, '') || coalesce(with_check, '')) like '%fruitroom_files%'
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

create policy "fruitroom_files_select" on storage.objects for select to authenticated
  using (bucket_id = 'fruitroom_files' and (storage.foldername(name))[1] = 'lots'
         and exists (select 1 from public.lots l where l.id::text = (storage.foldername(name))[2]));
create policy "fruitroom_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'fruitroom_files' and (storage.foldername(name))[1] = 'lots'
         and exists (select 1 from public.lots l where l.id::text = (storage.foldername(name))[2]));
create policy "fruitroom_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'fruitroom_files' and (storage.foldername(name))[1] = 'lots'
         and exists (select 1 from public.lots l where l.id::text = (storage.foldername(name))[2]));
