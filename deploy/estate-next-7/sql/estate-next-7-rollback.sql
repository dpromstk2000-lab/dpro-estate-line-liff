-- ESTATE-NEXT-7で追加した会員認証・再相談テーブルだけを削除します。
-- 既存の顧客、予約、物件、案件データには触れません。
begin;
drop table if exists public.estate_member_revisit_requests;
drop table if exists public.estate_member_auth_attempts;
drop table if exists public.estate_member_sessions;
commit;
