-- DPRO ESTATE NEXT-4 ロールバック
-- NEXT-4拡張テーブルだけを削除します。既存の顧客・予約・物件テーブルは変更しません。
begin;
drop table if exists public.estate_case_events cascade;
drop table if exists public.estate_vacancy_checks cascade;
drop table if exists public.estate_application_cases cascade;
drop function if exists public.dpro_estate_next4_touch_updated_at();
commit;
