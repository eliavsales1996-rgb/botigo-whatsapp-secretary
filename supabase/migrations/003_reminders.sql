-- ============================================================
-- Botigo — reminders table
-- ============================================================

create table if not exists reminders (
  id          uuid        primary key default gen_random_uuid(),
  business_id uuid        references businesses(id) on delete cascade,
  sender      text        not null,
  title       text        not null,
  remind_at   timestamptz not null,
  status      text        not null default 'pending'
                check (status in ('pending', 'sent', 'cancelled')),
  created_at  timestamptz not null default now()
);

create index if not exists reminders_sender_idx    on reminders(sender);
create index if not exists reminders_remind_at_idx on reminders(remind_at) where status = 'pending';

alter table reminders enable row level security;
