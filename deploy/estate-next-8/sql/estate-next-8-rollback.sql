-- ESTATE-NEXT-8 ロールバック
-- NEXT-8で追加した追客関連テーブルと再相談拡張列だけを削除します。
begin;

drop table if exists public.estate_property_proposals cascade;
drop table if exists public.estate_customer_exclusions cascade;
drop table if exists public.estate_followup_tasks cascade;

alter table if exists public.estate_member_revisit_requests
  drop column if exists assigned_staff_id,
  drop column if exists assigned_staff_name,
  drop column if exists due_date,
  drop column if exists staff_memo,
  drop column if exists completed_at,
  drop column if exists last_operation_id;

commit;
