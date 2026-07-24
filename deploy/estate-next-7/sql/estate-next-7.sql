-- DPRO 不動産・賃貸内見 LINE / ESTATE-NEXT-7
-- 会員セッション、本人確認試行、前回条件での再相談依頼を安全に保存します。
-- 電話番号そのものは保存せず、認証試行にはハッシュだけを保存します。再実行可能です。

begin;

create extension if not exists pgcrypto;

create table if not exists public.estate_member_sessions (
  id uuid primary key default gen_random_uuid(),
  shop_code text not null,
  customer_id text not null,
  token_hash text not null,
  auth_method text not null default 'reservation_code',
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint estate_member_sessions_auth_method_check check (auth_method in ('line','reservation_code','demo'))
);

create unique index if not exists estate_member_sessions_token_hash_uidx
  on public.estate_member_sessions(token_hash);
create index if not exists estate_member_sessions_customer_idx
  on public.estate_member_sessions(shop_code, customer_id, expires_at desc);
create index if not exists estate_member_sessions_expiry_idx
  on public.estate_member_sessions(expires_at);

create table if not exists public.estate_member_auth_attempts (
  key_hash text primary key,
  shop_code text not null,
  failed_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  constraint estate_member_auth_attempts_count_check check (failed_count >= 0)
);

create index if not exists estate_member_auth_attempts_block_idx
  on public.estate_member_auth_attempts(blocked_until);

create table if not exists public.estate_member_revisit_requests (
  id uuid primary key default gen_random_uuid(),
  shop_code text not null,
  customer_id text not null,
  session_id uuid references public.estate_member_sessions(id) on delete set null,
  request_type text not null default 'same_preferences',
  preference_snapshot jsonb not null default '{}'::jsonb,
  status text not null default '受付',
  operation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estate_member_revisit_request_type_check check (request_type in ('same_preferences','new_search')),
  constraint estate_member_revisit_status_check check (status in ('受付','対応中','完了','取消')),
  constraint estate_member_revisit_snapshot_check check (jsonb_typeof(preference_snapshot)='object')
);

create unique index if not exists estate_member_revisit_operation_uidx
  on public.estate_member_revisit_requests(shop_code, operation_id);
create index if not exists estate_member_revisit_customer_idx
  on public.estate_member_revisit_requests(shop_code, customer_id, created_at desc);

alter table public.estate_member_sessions enable row level security;
alter table public.estate_member_auth_attempts enable row level security;
alter table public.estate_member_revisit_requests enable row level security;

revoke all on public.estate_member_sessions from anon, authenticated;
revoke all on public.estate_member_auth_attempts from anon, authenticated;
revoke all on public.estate_member_revisit_requests from anon, authenticated;

grant all on public.estate_member_sessions to service_role;
grant all on public.estate_member_auth_attempts to service_role;
grant all on public.estate_member_revisit_requests to service_role;

comment on table public.estate_member_sessions is 'NEXT-7: 受付番号またはLINE本人確認後の短期会員セッション。生トークンは保存しない';
comment on table public.estate_member_auth_attempts is 'NEXT-7: 電話番号・IPを秘密値と合わせてハッシュ化した認証試行制限';
comment on table public.estate_member_revisit_requests is 'NEXT-7: 前回の希望条件でもう一度探す再相談依頼';

commit;

select
  to_regclass('public.estate_member_sessions') as member_sessions,
  to_regclass('public.estate_member_auth_attempts') as member_auth_attempts,
  to_regclass('public.estate_member_revisit_requests') as member_revisit_requests;
