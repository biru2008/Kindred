-- Read-only check. Run in Supabase SQL Editor; it does not modify accounts or data.
-- Each expected table should show published=true, row_security=true,
-- and authenticated_can_select=true. Inspect Logs > Realtime if all pass.
select expected.table_name,
       exists(select 1 from pg_publication_tables p
              where p.pubname='supabase_realtime' and p.schemaname='public'
              and p.tablename=expected.table_name) as published,
       c.relrowsecurity as row_security,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_select
from (values ('messages'), ('conversations'), ('conversation_members'),
             ('profiles'), ('group_invitations')) as expected(table_name)
left join pg_namespace n on n.nspname='public'
left join pg_class c on c.relnamespace=n.oid and c.relname=expected.table_name
order by expected.table_name;

select policyname, tablename, roles, cmd
from pg_policies
where (schemaname='realtime' and tablename='messages')
   or (schemaname='public' and tablename='messages');
