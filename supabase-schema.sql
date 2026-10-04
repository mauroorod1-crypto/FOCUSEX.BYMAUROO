create table if not exists public.user_data (
    user_id uuid primary key references auth.users(id) on delete cascade,
    data jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

create table if not exists public.habits (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    xp_value numeric not null default 0,
    frequency text not null default 'daily',
    weekly_goal integer not null default 1,
    color text,
    created_at timestamptz not null default now(),
    details jsonb not null default '{}'::jsonb
);

create table if not exists public.tasks (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    xp_value numeric not null default 0,
    priority text not null default 'medium',
    status text not null default 'pending',
    due_date date,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    details jsonb not null default '{}'::jsonb
);

alter table public.user_data enable row level security;
alter table public.habits enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "Users manage their own FOCUSEX state" on public.user_data;
create policy "Users manage their own FOCUSEX state"
    on public.user_data for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "Users manage their own habits" on public.habits;
create policy "Users manage their own habits"
    on public.habits for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "Users manage their own tasks" on public.tasks;
create policy "Users manage their own tasks"
    on public.tasks for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

grant select, insert, update, delete on public.user_data to authenticated;
grant select, insert, update, delete on public.habits to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
