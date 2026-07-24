-- ESTATE-NEXT-5 ロールバック
-- NEXT-5で追加した列・制約・索引だけを削除します。
-- NEXT-4までの案件、担当者、期限、見送り理由、空室履歴は維持します。

begin;

drop index if exists public.estate_application_cases_operation_uidx;
drop index if exists public.estate_vacancy_checks_operation_uidx;
drop index if exists public.estate_application_cases_intent_docs_idx;

alter table public.estate_application_cases drop constraint if exists estate_application_cases_intent_check;
alter table public.estate_application_cases drop constraint if exists estate_application_cases_cost_status_check;
alter table public.estate_application_cases drop constraint if exists estate_application_cases_cost_total_check;
alter table public.estate_application_cases drop constraint if exists estate_application_cases_breakdown_check;
alter table public.estate_application_cases drop constraint if exists estate_application_cases_documents_status_check;
alter table public.estate_application_cases drop constraint if exists estate_application_cases_documents_json_check;

alter table public.estate_vacancy_checks drop column if exists operation_id;
alter table public.estate_application_cases drop column if exists last_operation_id;
alter table public.estate_application_cases drop column if exists documents_updated_at;
alter table public.estate_application_cases drop column if exists documents_note;
alter table public.estate_application_cases drop column if exists required_documents;
alter table public.estate_application_cases drop column if exists documents_status;
alter table public.estate_application_cases drop column if exists initial_cost_updated_at;
alter table public.estate_application_cases drop column if exists initial_cost_note;
alter table public.estate_application_cases drop column if exists initial_cost_breakdown;
alter table public.estate_application_cases drop column if exists initial_cost_total;
alter table public.estate_application_cases drop column if exists initial_cost_status;
alter table public.estate_application_cases drop column if exists application_intent_confirmed_at;
alter table public.estate_application_cases drop column if exists application_intent;

commit;
