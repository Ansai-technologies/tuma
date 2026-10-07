create extension if not exists pgcrypto;

create table if not exists public.orders (
  id text primary key,
  vendor_id text not null,
  buyer_number text not null,
  description text not null,
  amount integer not null check (amount > 0),
  recipient text not null,
  state text not null check (state in ('open', 'awaiting_payment', 'verified', 'failed')),
  attestation_id text,
  last_reason_code text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists orders_buyer_open_idx
  on public.orders (buyer_number, created_at desc)
  where state not in ('verified', 'failed');

create table if not exists public.stk_checkouts (
  checkout_request_id text primary key,
  order_id text not null references public.orders (id) on delete cascade
);

create table if not exists public.processed_webhook_events (
  event_id text primary key,
  status text not null check (status in ('processing', 'completed', 'retryable')),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders (id) on delete cascade,
  source_key text not null,
  ordinal integer not null,
  recipient text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_key, ordinal)
);

alter table public.orders enable row level security;
alter table public.stk_checkouts enable row level security;
alter table public.processed_webhook_events enable row level security;
alter table public.notification_outbox enable row level security;

create or replace function public.claim_webhook_event(p_event_id text)
returns boolean
language plpgsql
as $$
declare
  claimed text;
begin
  insert into public.processed_webhook_events (event_id, status, updated_at)
  values (p_event_id, 'processing', now())
  on conflict (event_id) do update
    set status = 'processing', updated_at = now()
    where processed_webhook_events.status = 'retryable'
       or (processed_webhook_events.status = 'processing'
           and processed_webhook_events.updated_at < now() - interval '5 minutes')
  returning event_id into claimed;
  return claimed is not null;
end;
$$;

create or replace function public.commit_order_resolution(
  p_order jsonb,
  p_source_key text,
  p_notifications jsonb
)
returns void
language plpgsql
as $$
begin
  insert into public.orders (
    id, vendor_id, buyer_number, description, amount, recipient, state,
    attestation_id, last_reason_code, created_at, updated_at
  ) values (
    p_order->>'id', p_order->>'vendor_id', p_order->>'buyer_number',
    p_order->>'description', (p_order->>'amount')::integer,
    p_order->>'recipient', p_order->>'state', p_order->>'attestation_id',
    p_order->>'last_reason_code', (p_order->>'created_at')::timestamptz, now()
  )
  on conflict (id) do update set
    state = excluded.state,
    attestation_id = excluded.attestation_id,
    last_reason_code = excluded.last_reason_code,
    updated_at = now();

  insert into public.notification_outbox (order_id, source_key, ordinal, recipient, body)
  select p_order->>'id', p_source_key, item.ordinality - 1,
         item.value->>'recipient', item.value->>'body'
  from jsonb_array_elements(p_notifications) with ordinality as item(value, ordinality)
  on conflict (source_key, ordinal) do nothing;
end;
$$;

create or replace function public.claim_outbox_notifications(p_order_id text default null)
returns setof public.notification_outbox
language sql
as $$
  with claimable as (
    select id
    from public.notification_outbox
    where (status = 'pending'
       or (status = 'sending' and updated_at < now() - interval '5 minutes'))
      and (p_order_id is null or order_id = p_order_id)
    order by created_at
    for update skip locked
    limit 100
  )
  update public.notification_outbox as notifications
  set status = 'sending', updated_at = now()
  from claimable
  where notifications.id = claimable.id
  returning notifications.*;
$$;
