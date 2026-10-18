-- Articulate initial schema.
-- Apply this migration only to the intended Supabase project.
-- User-owned rows are protected by Row Level Security.

create table if not exists public.speaking_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Speaking practice',
  transcript text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.speaking_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.speaking_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  overall_summary text,
  strengths jsonb not null default '[]'::jsonb,
  improvements jsonb not null default '[]'::jsonb,
  filler_words jsonb not null default '[]'::jsonb,
  raw_feedback jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint speaking_feedback_one_per_session unique (session_id)
);

create index if not exists speaking_sessions_user_created_idx
  on public.speaking_sessions (user_id, created_at desc);

create index if not exists speaking_feedback_user_created_idx
  on public.speaking_feedback (user_id, created_at desc);

alter table public.speaking_sessions enable row level security;
alter table public.speaking_feedback enable row level security;

create policy "Users can read their own speaking sessions"
  on public.speaking_sessions for select
  using (auth.uid() = user_id);

create policy "Users can create their own speaking sessions"
  on public.speaking_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own speaking sessions"
  on public.speaking_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own speaking sessions"
  on public.speaking_sessions for delete
  using (auth.uid() = user_id);

create policy "Users can read their own speaking feedback"
  on public.speaking_feedback for select
  using (auth.uid() = user_id);

-- Feedback is written by the trusted Edge Function using server-side credentials.
-- No client insert/update/delete policy is intentionally created for this table.
