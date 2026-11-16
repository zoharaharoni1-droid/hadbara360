-- 💳 דיווחי תשלום מדף התשלום ללקוח (hadbara360.co.il/p/)
-- הלקוח יכול רק להוסיף דיווח (לא לקרוא ולא לשנות). רק משתמשי המערכת רואים ומטפלים.
create table if not exists public.pay_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  ref text,
  req_id text,
  amount numeric,
  method text,
  name text,
  tax_id text,
  phone text,
  email text,
  address text,
  descr text,
  status text not null default 'new',
  handled_at timestamptz,
  handled_by text,
  doc_id text
);
alter table public.pay_reports enable row level security;

drop policy if exists pay_reports_insert_public on public.pay_reports;
create policy pay_reports_insert_public on public.pay_reports
  for insert to anon, authenticated
  with check (
    status = 'new' and handled_at is null and doc_id is null
    and coalesce(length(name),0) <= 200 and coalesce(length(descr),0) <= 500
    and coalesce(length(address),0) <= 300 and coalesce(amount,0) between 0 and 1000000
  );

drop policy if exists pay_reports_staff_read on public.pay_reports;
create policy pay_reports_staff_read on public.pay_reports
  for select to authenticated using (true);

drop policy if exists pay_reports_staff_update on public.pay_reports;
create policy pay_reports_staff_update on public.pay_reports
  for update to authenticated using (true) with check (true);

grant insert on public.pay_reports to anon, authenticated;
grant select, update on public.pay_reports to authenticated;
