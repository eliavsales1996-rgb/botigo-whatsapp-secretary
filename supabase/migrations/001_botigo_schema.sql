-- ============================================================
-- Botigo SaaS — initial schema
-- Run this in your Supabase SQL editor (or via supabase db push)
-- ============================================================

-- ---------------------------------------------------------------
-- BUSINESSES
-- One row per paying Botigo customer / registered business.
-- ---------------------------------------------------------------
create table if not exists businesses (
  id              uuid primary key default gen_random_uuid(),
  name            text        not null,
  -- Twilio-formatted owner phone, e.g. "whatsapp:+972501234567"
  owner_phone     text        not null unique,
  -- Custom system-prompt for this business's customers.
  -- Leave null to use the generic fallback in persona.js.
  sales_prompt    text,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- CUSTOMERS
-- People who contact a business through Botigo.
-- ---------------------------------------------------------------
create table if not exists customers (
  id              uuid primary key default gen_random_uuid(),
  -- Twilio-formatted phone, e.g. "whatsapp:+972521234567"
  phone           text        not null unique,
  business_id     uuid        not null references businesses(id) on delete cascade,
  display_name    text,
  created_at      timestamptz not null default now()
);

create index if not exists customers_business_idx on customers(business_id);

-- ---------------------------------------------------------------
-- MESSAGES
-- Every inbound and outbound message, keyed by sender phone.
-- For owners and leads the sender_phone IS the conversation id.
-- For customers the business context is resolved at runtime via
-- the customers table.
-- ---------------------------------------------------------------
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  -- Twilio-formatted phone of the human side of the conversation
  sender_phone    text        not null,
  role            text        not null check (role in ('user', 'assistant')),
  content         text        not null,
  -- Populated for voice/media messages
  media_url       text,
  media_type      text,
  created_at      timestamptz not null default now()
);

-- Speed up history fetches (latest N messages per phone)
create index if not exists messages_phone_time_idx
  on messages(sender_phone, created_at desc);

-- ---------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Enable RLS so that the anon/public key cannot read messages.
-- The server uses the service-role key which bypasses RLS.
-- ---------------------------------------------------------------
alter table businesses enable row level security;
alter table customers  enable row level security;
alter table messages   enable row level security;

-- No public policies — only the service-role key (used in src/supabase.js)
-- can read/write these tables.
