-- SAISOKU Supabase grant tightening
-- RLS controls rows, but object grants still decide which API roles can discover/use objects.

begin;

-- Remove broad grants inherited by anon/authenticated via PUBLIC.
revoke all on all tables in schema public from public;
revoke all on all sequences in schema public from public;
revoke execute on all functions in schema public from public;

-- Be explicit for API roles.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

revoke all on all tables in schema public from authenticated;
revoke all on all sequences in schema public from authenticated;
revoke execute on all functions in schema public from authenticated;

-- The admin panel is read-only for signed-in Supabase Auth users at this stage.
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;

-- Edge Functions/bot use service_role and should keep full operational access.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

commit;
