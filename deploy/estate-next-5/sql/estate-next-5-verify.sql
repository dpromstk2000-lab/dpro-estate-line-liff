-- ESTATE-NEXT-5 適用確認
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public'
  and table_name='estate_application_cases'
  and column_name in (
    'application_intent','application_intent_confirmed_at','initial_cost_status','initial_cost_total',
    'initial_cost_breakdown','initial_cost_note','initial_cost_updated_at','documents_status',
    'required_documents','documents_note','documents_updated_at','last_operation_id'
  )
order by ordinal_position;

select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='estate_vacancy_checks' and column_name='operation_id';

select indexname
from pg_indexes
where schemaname='public' and indexname in (
  'estate_application_cases_operation_uidx','estate_vacancy_checks_operation_uidx','estate_application_cases_intent_docs_idx'
)
order by indexname;
