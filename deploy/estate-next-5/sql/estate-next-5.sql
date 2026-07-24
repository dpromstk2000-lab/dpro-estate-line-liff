-- DPRO 不動産・賃貸内見 LINE / ESTATE-NEXT-5
-- 初期費用概算、申込意思、必要書類チェック、二重操作防止を追加します。
-- 既存案件・予約・顧客・物件データは削除しません。再実行可能です。

begin;

alter table public.estate_application_cases add column if not exists application_intent text not null default '未確認';
alter table public.estate_application_cases add column if not exists application_intent_confirmed_at timestamptz;
alter table public.estate_application_cases add column if not exists initial_cost_status text not null default '未確認';
alter table public.estate_application_cases add column if not exists initial_cost_total bigint not null default 0;
alter table public.estate_application_cases add column if not exists initial_cost_breakdown jsonb not null default '{}'::jsonb;
alter table public.estate_application_cases add column if not exists initial_cost_note text;
alter table public.estate_application_cases add column if not exists initial_cost_updated_at timestamptz;
alter table public.estate_application_cases add column if not exists documents_status text not null default '未案内';
alter table public.estate_application_cases add column if not exists required_documents jsonb not null default '[]'::jsonb;
alter table public.estate_application_cases add column if not exists documents_note text;
alter table public.estate_application_cases add column if not exists documents_updated_at timestamptz;
alter table public.estate_application_cases add column if not exists last_operation_id text;
alter table public.estate_vacancy_checks add column if not exists operation_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='estate_application_cases_intent_check') then
    alter table public.estate_application_cases add constraint estate_application_cases_intent_check check (application_intent in ('未確認','検討中','申込希望','保留','申込しない'));
  end if;
  if not exists (select 1 from pg_constraint where conname='estate_application_cases_cost_status_check') then
    alter table public.estate_application_cases add constraint estate_application_cases_cost_status_check check (initial_cost_status in ('未確認','概算作成中','概算提示済み','説明済み','合意'));
  end if;
  if not exists (select 1 from pg_constraint where conname='estate_application_cases_cost_total_check') then
    alter table public.estate_application_cases add constraint estate_application_cases_cost_total_check check (initial_cost_total >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='estate_application_cases_breakdown_check') then
    alter table public.estate_application_cases add constraint estate_application_cases_breakdown_check check (jsonb_typeof(initial_cost_breakdown)='object');
  end if;
  if not exists (select 1 from pg_constraint where conname='estate_application_cases_documents_status_check') then
    alter table public.estate_application_cases add constraint estate_application_cases_documents_status_check check (documents_status in ('未案内','案内済み','回収中','確認中','完了'));
  end if;
  if not exists (select 1 from pg_constraint where conname='estate_application_cases_documents_json_check') then
    alter table public.estate_application_cases add constraint estate_application_cases_documents_json_check check (jsonb_typeof(required_documents)='array');
  end if;
end $$;

create unique index if not exists estate_application_cases_operation_uidx
  on public.estate_application_cases (shop_code, last_operation_id)
  where last_operation_id is not null;
create unique index if not exists estate_vacancy_checks_operation_uidx
  on public.estate_vacancy_checks (shop_code, operation_id)
  where operation_id is not null;
create index if not exists estate_application_cases_intent_docs_idx
  on public.estate_application_cases (shop_code, application_intent, documents_status, updated_at desc);

comment on column public.estate_application_cases.application_intent is 'NEXT-5: お客様の申込意思確認結果';
comment on column public.estate_application_cases.initial_cost_breakdown is 'NEXT-5: 初期費用の概算内訳。確定請求ではない';
comment on column public.estate_application_cases.required_documents is 'NEXT-5: 書類自体ではなく案内・受領・確認状態のみ';
comment on column public.estate_application_cases.last_operation_id is 'NEXT-5: 二重操作防止用のクライアント操作ID';
comment on column public.estate_vacancy_checks.operation_id is 'NEXT-5: 空室確認の二重登録防止ID';

commit;

select
  to_regclass('public.estate_application_cases') as application_cases,
  to_regclass('public.estate_vacancy_checks') as vacancy_checks,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='estate_application_cases' and column_name='required_documents') as required_documents_ready,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='estate_application_cases' and column_name='initial_cost_breakdown') as initial_cost_ready,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='estate_application_cases' and column_name='last_operation_id') as idempotency_ready;
