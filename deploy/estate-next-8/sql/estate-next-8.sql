-- DPRO 不動産・賃貸内見 LINE / ESTATE-NEXT-8
-- 再相談・内見後追客・物件提案・除外条件を安全に永続化します。再実行可能です。

begin;

create extension if not exists pgcrypto;

alter table public.estate_member_revisit_requests
  add column if not exists assigned_staff_id text,
  add column if not exists assigned_staff_name text,
  add column if not exists due_date date,
  add column if not exists staff_memo text,
  add column if not exists completed_at timestamptz,
  add column if not exists last_operation_id text;

create table if not exists public.estate_followup_tasks (
  id uuid primary key default gen_random_uuid(),
  shop_code text not null,
  customer_id text not null,
  customer_name text,
  reservation_id text,
  application_case_id uuid references public.estate_application_cases(id) on delete set null,
  revisit_request_id uuid references public.estate_member_revisit_requests(id) on delete set null,
  task_type text not null default 'manual',
  status text not null default '未対応',
  priority text not null default '通常',
  due_date date,
  assigned_staff_id text,
  assigned_staff_name text,
  summary text,
  memo text,
  last_operation_id text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estate_followup_tasks_type_check check (task_type in ('post_viewing','revisit','new_property','manual')),
  constraint estate_followup_tasks_status_check check (status in ('未対応','対応中','保留','完了','取消')),
  constraint estate_followup_tasks_priority_check check (priority in ('高','通常','低'))
);

create unique index if not exists estate_followup_tasks_operation_uidx
  on public.estate_followup_tasks(shop_code, last_operation_id)
  where last_operation_id is not null;
create index if not exists estate_followup_tasks_due_idx
  on public.estate_followup_tasks(shop_code, status, due_date, created_at desc);
create index if not exists estate_followup_tasks_customer_idx
  on public.estate_followup_tasks(shop_code, customer_id, created_at desc);
create index if not exists estate_followup_tasks_revisit_idx
  on public.estate_followup_tasks(shop_code, revisit_request_id)
  where revisit_request_id is not null;
create unique index if not exists estate_followup_tasks_open_reservation_uidx
  on public.estate_followup_tasks(shop_code, reservation_id, task_type)
  where reservation_id is not null and status in ('未対応','対応中','保留');

create table if not exists public.estate_property_proposals (
  id uuid primary key default gen_random_uuid(),
  shop_code text not null,
  customer_id text not null,
  property_id text not null,
  followup_task_id uuid references public.estate_followup_tasks(id) on delete set null,
  proposal_status text not null default '候補',
  match_score integer not null default 0,
  match_reasons jsonb not null default '[]'::jsonb,
  property_name text,
  area_name text,
  rent_amount integer,
  floor_plan text,
  memo text,
  operation_id text not null,
  proposed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estate_property_proposals_status_check check (proposal_status in ('候補','文面作成','コピー済み','内見希望','見送り')),
  constraint estate_property_proposals_score_check check (match_score between 0 and 100),
  constraint estate_property_proposals_reasons_check check (jsonb_typeof(match_reasons)='array')
);

create unique index if not exists estate_property_proposals_operation_uidx
  on public.estate_property_proposals(shop_code, operation_id);
create index if not exists estate_property_proposals_customer_idx
  on public.estate_property_proposals(shop_code, customer_id, created_at desc);
create index if not exists estate_property_proposals_property_idx
  on public.estate_property_proposals(shop_code, property_id, created_at desc);

create table if not exists public.estate_customer_exclusions (
  id uuid primary key default gen_random_uuid(),
  shop_code text not null,
  customer_id text not null,
  excluded_property_ids jsonb not null default '[]'::jsonb,
  excluded_areas jsonb not null default '[]'::jsonb,
  excluded_keywords jsonb not null default '[]'::jsonb,
  max_rent_override integer,
  memo text,
  last_operation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estate_customer_exclusions_property_ids_check check (jsonb_typeof(excluded_property_ids)='array'),
  constraint estate_customer_exclusions_areas_check check (jsonb_typeof(excluded_areas)='array'),
  constraint estate_customer_exclusions_keywords_check check (jsonb_typeof(excluded_keywords)='array'),
  constraint estate_customer_exclusions_rent_check check (max_rent_override is null or max_rent_override >= 0),
  unique(shop_code, customer_id)
);

create index if not exists estate_customer_exclusions_customer_idx
  on public.estate_customer_exclusions(shop_code, customer_id);

alter table public.estate_followup_tasks enable row level security;
alter table public.estate_property_proposals enable row level security;
alter table public.estate_customer_exclusions enable row level security;

revoke all on public.estate_followup_tasks from anon, authenticated;
revoke all on public.estate_property_proposals from anon, authenticated;
revoke all on public.estate_customer_exclusions from anon, authenticated;

grant all on public.estate_followup_tasks to service_role;
grant all on public.estate_property_proposals to service_role;
grant all on public.estate_customer_exclusions to service_role;

comment on table public.estate_followup_tasks is 'NEXT-8: 内見後・再相談・新着物件提案の追客タスク';
comment on table public.estate_property_proposals is 'NEXT-8: 顧客別の物件提案履歴と二重提案防止';
comment on table public.estate_customer_exclusions is 'NEXT-8: 顧客別の物件提案除外条件';

commit;

select
  to_regclass('public.estate_followup_tasks') as followup_tasks,
  to_regclass('public.estate_property_proposals') as property_proposals,
  to_regclass('public.estate_customer_exclusions') as customer_exclusions;
