-- 회원 탈퇴: 로그인한 본인 계정만 지웁니다. 프로필 등 auth.users를 참조하는 행은 on delete cascade로 함께 지워집니다.
-- 사과 기록은 서버(/api/account/delete)가 먼저 지운 뒤 이 함수를 부릅니다.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
