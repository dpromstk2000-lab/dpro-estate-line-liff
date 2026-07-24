select
  to_regclass('public.estate_member_sessions') is not null as member_sessions_ready,
  to_regclass('public.estate_member_auth_attempts') is not null as member_auth_attempts_ready,
  to_regclass('public.estate_member_revisit_requests') is not null as member_revisit_requests_ready,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='estate_member_sessions' and column_name='token_hash') as token_hash_ready,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='estate_member_revisit_requests' and column_name='preference_snapshot') as preference_snapshot_ready;
