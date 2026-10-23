-- Optional AI request budget. Existing lots/records/policies are not changed.
-- Apply once with the Supabase SQL editor. AI remains OFF until an administrator
-- sets the protected limits row after configuring the provider and its prices.
begin;
create table if not exists public.ai_limits (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  monthly_budget_usd numeric(12,6) not null default 0 check (monthly_budget_usd >= 0),
  max_request_usd numeric(12,6) not null default 0.10 check (max_request_usd > 0),
  per_user_daily integer not null default 30 check (per_user_daily between 1 and 1000),
  per_user_minute integer not null default 4 check (per_user_minute between 1 and 60),
  mcp_per_user_minute integer not null default 30 check (mcp_per_user_minute between 1 and 120)
);
insert into public.ai_limits(singleton) values(true) on conflict do nothing;
create table if not exists public.ai_budget_reservations (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reserved_usd numeric(12,6) not null check(reserved_usd > 0),
  created_at timestamptz not null default now()
);
create index if not exists ai_budget_user_created on public.ai_budget_reservations(user_id,created_at);
create index if not exists ai_budget_created on public.ai_budget_reservations(created_at);
create table if not exists public.ai_read_windows (
  user_id uuid not null references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  requests integer not null check(requests > 0),
  primary key(user_id,window_start)
);
alter table public.ai_limits enable row level security;
alter table public.ai_budget_reservations enable row level security;
alter table public.ai_read_windows enable row level security;
revoke all on public.ai_limits,public.ai_budget_reservations,public.ai_read_windows from public,anon,authenticated;

create or replace function public.consume_ai_read_quota() returns boolean
language plpgsql security definer set search_path=public as $$
declare uid uuid; lim integer; used integer;
begin
  uid:=auth.uid();if uid is null then raise exception 'Authentication required';end if;
  select mcp_per_user_minute into lim from public.ai_limits where singleton;
  if lim is null then return false;end if;
  insert into public.ai_read_windows(user_id,window_start,requests) values(uid,date_trunc('minute',now()),1)
    on conflict(user_id,window_start) do update set requests=public.ai_read_windows.requests+1
    where public.ai_read_windows.requests < lim returning requests into used;
  return used is not null;
end $$;

create or replace function public.ai_budget_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg public.ai_limits; spent numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into cfg from public.ai_limits where singleton;
  select coalesce(sum(reserved_usd),0) into spent from public.ai_budget_reservations
    where created_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
  return jsonb_build_object('enabled',coalesce(cfg.enabled,false),'available',coalesce(cfg.enabled and cfg.monthly_budget_usd > spent,false));
end $$;

create or replace function public.reserve_ai_budget(p_request_id uuid,p_cost_usd numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg public.ai_limits; uid uuid; spent numeric; n integer;
begin
  uid:=auth.uid();
  if uid is null then raise exception 'Authentication required'; end if;
  -- A single protected row serializes reservations across all server instances.
  select * into cfg from public.ai_limits where singleton for update;
  if not found or not cfg.enabled or cfg.monthly_budget_usd <= 0 then
    return jsonb_build_object('allowed',false,'code','budget_not_configured');
  end if;
  if p_request_id is null or p_cost_usd is null or p_cost_usd <= 0 or p_cost_usd > cfg.max_request_usd then
    return jsonb_build_object('allowed',false,'code','request_budget_exceeded');
  end if;
  if exists(select 1 from public.ai_budget_reservations where request_id=p_request_id) then
    return jsonb_build_object('allowed',false,'code','duplicate_request');
  end if;
  select count(*) into n from public.ai_budget_reservations where user_id=uid and created_at>now()-interval '1 minute';
  if n>=cfg.per_user_minute then return jsonb_build_object('allowed',false,'code','rate_limit'); end if;
  select count(*) into n from public.ai_budget_reservations where user_id=uid and created_at>now()-interval '24 hours';
  if n>=cfg.per_user_daily then return jsonb_build_object('allowed',false,'code','daily_limit'); end if;
  select coalesce(sum(reserved_usd),0) into spent from public.ai_budget_reservations
    where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
  if spent+p_cost_usd>cfg.monthly_budget_usd then return jsonb_build_object('allowed',false,'code','monthly_limit'); end if;
  insert into public.ai_budget_reservations(request_id,user_id,reserved_usd) values(p_request_id,uid,ceil(p_cost_usd*1000000)/1000000);
  return jsonb_build_object('allowed',true,'reservation_id',p_request_id);
end $$;
revoke all on function public.ai_budget_status() from public,anon;
revoke all on function public.reserve_ai_budget(uuid,numeric) from public,anon;
grant execute on function public.ai_budget_status() to authenticated;
grant execute on function public.reserve_ai_budget(uuid,numeric) to authenticated;
revoke all on function public.consume_ai_read_quota() from public,anon;
grant execute on function public.consume_ai_read_quota() to authenticated;
commit;

-- Administrator activation example (choose the budget; do not copy a guessed value):
-- update public.ai_limits set enabled=true,monthly_budget_usd=<approved monthly budget> where singleton;
-- Disable immediately: update public.ai_limits set enabled=false where singleton;
-- Retention: after month-end billing reconciliation, an administrator may delete
-- reservations older than 90 days. Never delete current-month rows: they enforce
-- the current budget. These rows contain no prompts, replies or lot contents.
-- Read quota windows older than 2 days may also be removed by an administrator.
