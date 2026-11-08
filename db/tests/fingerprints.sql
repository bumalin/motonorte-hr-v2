-- Row count + content hash of every public table, one line per table: "table|rows|md5".
-- Run on two databases and diff the output to prove a restore matches its source (works on real data,
-- unlike verify.sql, which needs the synthetic seed). Read-only.
SET TIME ZONE 'Asia/Manila';
SELECT format('SELECT %L || ''|'' || count(*) || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, E''\n'' ORDER BY to_jsonb(t)::text)), ''empty'') FROM public.%I t;', tablename, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\gexec
