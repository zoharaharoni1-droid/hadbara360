-- ═══════════════════════════════════════════════════════════════
-- הדברה 360 — מספור רציף של מסמכים חשבונאיים (חשבונית מס, חשבונית מס/קבלה, קבלה, חשבונית זיכוי)
-- להריץ פעם אחת ב-Supabase → SQL Editor → New query → Run
-- המספר נקבע בשרת, כך שגם אם שני משתמשים מפיקים מסמך באותו רגע — לא יהיה מספר כפול ולא יהיה חור.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.doc_counters (
  doc_type   text primary key,
  last_seq   integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.doc_counters enable row level security;
drop policy if exists doc_counters_crm on public.doc_counters;
create policy doc_counters_crm on public.doc_counters for select to authenticated using (public.is_crm_user());
revoke all on public.doc_counters from anon;
grant select on public.doc_counters to authenticated;

-- מחזיר את המספר הבא לסוג המסמך (לפחות p_min — כדי להמשיך מהמספור של התוכנה הקודמת)
create or replace function public.next_doc_seq(p_type text, p_min integer default 1)
returns integer
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  if not public.is_crm_user() then raise exception 'not allowed'; end if;
  if p_type not in ('חשבונית מס','חשבונית מס/קבלה','קבלה','חשבונית זיכוי') then raise exception 'bad document type'; end if;
  insert into public.doc_counters(doc_type, last_seq) values (p_type, 0) on conflict (doc_type) do nothing;
  update public.doc_counters
     set last_seq = greatest(last_seq + 1, coalesce(p_min, 1)), updated_at = now()
   where doc_type = p_type
  returning last_seq into v;
  return v;
end $$;

revoke all on function public.next_doc_seq(text, integer) from public, anon;
grant execute on function public.next_doc_seq(text, integer) to authenticated;

select 'doc numbering ready' as status;
