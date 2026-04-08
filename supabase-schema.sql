create table if not exists summaries (
  id uuid default gen_random_uuid() primary key,
  ticker text unique not null,
  one_liner text not null,
  detail text not null,
  headlines jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_summaries_ticker on summaries (ticker);
