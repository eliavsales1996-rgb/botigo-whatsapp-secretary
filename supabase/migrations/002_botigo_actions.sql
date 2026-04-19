-- ============================================================
-- Botigo SaaS — native actions schema
-- Run this in your Supabase SQL editor after 001_botigo_schema.sql
-- ============================================================

-- ---------------------------------------------------------------
-- LEADS
-- Potential customers collected by the sales bot.
-- ---------------------------------------------------------------
create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid references businesses(id) on delete cascade,
  name            text        not null,
  phone           text,
  source          text        not null default 'whatsapp',
  status          text        not null default 'new'
                    check (status in ('new', 'contacted', 'qualified', 'closed_won', 'closed_lost')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists leads_business_idx    on leads(business_id);
create index if not exists leads_status_idx      on leads(business_id, status);
create index if not exists leads_phone_idx       on leads(phone);

-- auto-update updated_at on row change
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists leads_set_updated_at on leads;
create trigger leads_set_updated_at
  before update on leads
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- APPOINTMENTS
-- Scheduled sessions / meetings between customers and a business.
-- ---------------------------------------------------------------
create table if not exists appointments (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid references businesses(id) on delete cascade,
  customer_name    text        not null,
  customer_phone   text,
  service          text,
  appointment_date date        not null,
  appointment_time time        not null,
  status           text        not null default 'confirmed'
                     check (status in ('confirmed', 'cancelled', 'completed')),
  notes            text,
  created_at       timestamptz not null default now()
);

create index if not exists appointments_business_idx on appointments(business_id);
create index if not exists appointments_date_idx     on appointments(business_id, appointment_date);
create index if not exists appointments_phone_idx    on appointments(customer_phone);

-- ---------------------------------------------------------------
-- EXPENSES
-- Business expense log (used by the owner assistant).
-- ---------------------------------------------------------------
create table if not exists expenses (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid references businesses(id) on delete cascade,
  amount          numeric(12, 2) not null check (amount > 0),
  category        text,
  description     text,
  expense_date    date        not null default current_date,
  created_at      timestamptz not null default now()
);

create index if not exists expenses_business_idx on expenses(business_id);
create index if not exists expenses_date_idx     on expenses(business_id, expense_date);

-- ---------------------------------------------------------------
-- RLS — same policy as other tables: service-role only
-- ---------------------------------------------------------------
alter table leads        enable row level security;
alter table appointments enable row level security;
alter table expenses     enable row level security;
