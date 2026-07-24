-- DPRO ESTATE NEXT-4 適用確認（値は表示せず、構造と件数だけ確認）
select 'estate_application_cases' as table_name, count(*)::bigint as row_count from public.estate_application_cases
union all
select 'estate_case_events', count(*)::bigint from public.estate_case_events
union all
select 'estate_vacancy_checks', count(*)::bigint from public.estate_vacancy_checks;

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('estate_application_cases','estate_case_events','estate_vacancy_checks')
order by table_name, ordinal_position;
