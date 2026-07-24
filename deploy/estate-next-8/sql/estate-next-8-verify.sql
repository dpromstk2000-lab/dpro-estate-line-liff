-- ESTATE-NEXT-8 適用確認
select
  to_regclass('public.estate_followup_tasks') as followup_tasks,
  to_regclass('public.estate_property_proposals') as property_proposals,
  to_regclass('public.estate_customer_exclusions') as customer_exclusions;

select column_name, data_type
from information_schema.columns
where table_schema='public'
  and table_name='estate_member_revisit_requests'
  and column_name in ('assigned_staff_id','assigned_staff_name','due_date','staff_memo','completed_at','last_operation_id')
order by column_name;

select schemaname, tablename, rowsecurity
from pg_tables
where schemaname='public'
  and tablename in ('estate_followup_tasks','estate_property_proposals','estate_customer_exclusions')
order by tablename;
