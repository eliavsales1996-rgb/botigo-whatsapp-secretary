-- Add owner_name to businesses so the bot can address the owner by name
alter table businesses add column if not exists owner_name text;
