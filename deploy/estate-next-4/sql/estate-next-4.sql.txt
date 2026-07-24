-- DPRO 不動産・賃貸内見 LINE / ESTATE-NEXT-4
-- 既存テーブルは変更せず、案件進捗と空室確認履歴を拡張テーブルへ永続化します。
-- 再実行可能です。

begin;

create extension if not exists pgcrypto;

create or replace function public.dpro_estate_next4_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.estate_application_cases (
  id uuid primary key default gen_random_uuid(),
  shop_code text not null,
  customer_id text not null,
  property_id text,
  reservation_id text,
  stage_key text not null default 'inquiry',
  application_status text not null default '申込前',
  assigned_staff_id text,
  assigned_staff_name text,
  next_action text,
  next_action_due_date date,
  viewing_memo text,
  lost_reason text,
  internal_memo text,
  last_activity_at timestamptz not null default now(),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estate_application_cases_stage_check check (
    stage_key in ('inquiry','conditions','proposal','viewing','viewed','application','contracted','closed')
  ),
  constraint estate_application_cases_version_check check (version >= 1),
  constraint estate_application_cases_lost_reason_check check (
    stage_key <> 'closed' or nullif(btrim(coalesce(lost_reason, '')), '') is not null
  )
);

alter table public.estate_application_cases add column if not exists property_id text;
alter table public.estate_application_cases add column if not exists reservation_id text;
alter table public.estate_application_cases add column if not exists stage_key text not null default 'inquiry';
alter table public.estate_application_cases add column if not exists application_status text not null default '申込前';
alter table public.estate_application_cases add column if not exists assigned_staff_id text;
alter table public.estate_application_cases add column if not exists assigned_staff_name text;
alter table public.estate_application_cases add column if not exists next_action text;
alter table public.estate_application_cases add column if not exists next_action_due_date date;
alter table public.estate_application_cases add column if not exists viewing_memo text;
alter table public.estate_application_cases add column if not exists lost_reason text;
alter table public.estate_application_cases add column if not exists internal_memo text;
alter table public.estate_application_cases add column if not exists last_activity_at timestamptz not null default now();
alter table public.estate_application_cases add column if not exists version integer not null default 1;
alter table public.estate_application_cases add column if not exists created_at timestamptz not null default now();
alter table public.estate_application_cases add column if not exists updated_at timestamptz not null default now();

create unique index if not exists estate_application_cases_shop_customer_uidx
  on public.estate_application_cases (shop_code, customer_id);
create index if not exists estate_application_cases_shop_stage_idx
  on public.estate_application_cases (shop_code, stage_key, next_action_due_date);
create index if not exists estate_application_cases_shop_staff_idx
  on public.estate_application_cases (shop_code, assigned_staff_id, updated_at desc);
create index if not exists estate_application_cases_property_idx
  on public.estate_application_cases (shop_code, property_id) where property_id is not null;

create table if not exists public.estate_case_events (
  id uuid primary key default gen_random_uuid(),
  shop_code text not null,
  case_id uuid not null references public.estate_application_cases(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'owner',
  actor_name text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists estate_case_events_case_created_idx
  on public.estate_case_events (case_id, created_at desc);
create index if not exists estate_case_events_shop_created_idx
  on public.estate_case_events (shop_code, created_at desc);

create table if not exists public.estate_vacancy_checks (
  id uuid primary key default gen_random_uuid(),
  shop_code text not null,
  property_id text not null,
  result text not null,
  checked_at timestamptz not null default now(),
  checked_by_staff_id text,
  checked_by_staff_name text,
  next_check_due_date date,
  source text not null default 'owner',
  memo text,
  created_at timestamptz not null default now(),
  constraint estate_vacancy_checks_result_check check (
    result in ('募集中','確認中','申込あり','成約済み','不明')
  )
);

create index if not exists estate_vacancy_checks_property_checked_idx
  on public.estate_vacancy_checks (shop_code, property_id, checked_at desc);
create index if not exists estate_vacancy_checks_due_idx
  on public.estate_vacancy_checks (shop_code, next_check_due_date)
  where next_check_due_date is not null;

alter table public.estate_application_cases enable row level security;
alter table public.estate_case_events enable row level security;
alter table public.estate_vacancy_checks enable row level security;

revoke all on table public.estate_application_cases from anon, authenticated;
revoke all on table public.estate_case_events from anon, authenticated;
revoke all on table public.estate_vacancy_checks from anon, authenticated;
grant all on table public.estate_application_cases to service_role;
grant all on table public.estate_case_events to service_role;
grant all on table public.estate_vacancy_checks to service_role;

DROP TRIGGER IF EXISTS estate_application_cases_touch_updated_at ON public.estate_application_cases;
create trigger estate_application_cases_touch_updated_at
before update on public.estate_application_cases
for each row execute function public.dpro_estate_next4_touch_updated_at();

comment on table public.estate_application_cases is 'DPRO ESTATE NEXT-4: 顧客ごとの現在案件・担当・次アクション・期限・見送り理由';
comment on table public.estate_case_events is 'DPRO ESTATE NEXT-4: 案件変更履歴';
comment on table public.estate_vacancy_checks is 'DPRO ESTATE NEXT-4: 物件ごとの空室確認履歴';

commit;

-- 実行後確認
select
  to_regclass('public.estate_application_cases') as application_cases,
  to_regclass('public.estate_case_events') as case_events,
  to_regclass('public.estate_vacancy_checks') as vacancy_checks;
