-- Run this once in your Supabase SQL Editor

-- Users usage tracking table
create table if not exists public.usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null default current_date,
  count integer not null default 0,
  unique(user_id, date)
);

-- Subscriptions table
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  plan text not null default 'free',          -- 'free' | 'pro' | 'booster'
  status text not null default 'active',      -- 'active' | 'expired' | 'cancelled'
  razorpay_payment_id text,
  razorpay_order_id text,
  started_at timestamptz default now(),
  expires_at timestamptz,
  created_at timestamptz default now()
);

-- Row Level Security (users can only see their own data)
alter table public.usage enable row level security;
alter table public.subscriptions enable row level security;

create policy "Users can read own usage"
  on public.usage for select using (auth.uid() = user_id);

create policy "Users can update own usage"
  on public.usage for all using (auth.uid() = user_id);

create policy "Users can read own subscription"
  on public.subscriptions for select using (auth.uid() = user_id);

-- Service role can do everything (for backend API)
create policy "Service role full access usage"
  on public.usage for all using (true) with check (true);

create policy "Service role full access subscriptions"
  on public.subscriptions for all using (true) with check (true);
