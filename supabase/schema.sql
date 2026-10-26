-- ===========================================================================
-- Amazon Quick · AI Workspace & RAG Knowledge Base
-- Supabase (PostgreSQL) schema — 100% free tier compatible.
--
-- Run this in:  Supabase Dashboard → SQL Editor → New query → Run
-- Or:           psql "$SUPABASE_DB_URL" -f supabase/schema.sql
--
-- The app works without Supabase (browser IndexedDB fallback), but running
-- this script unlocks cloud sync + pgvector hybrid retrieval.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
-- `vector`  : pgvector, for cosine similarity (Hybrid RAG · Mode 2)
-- `pgcrypto` : gen_random_uuid()
-- The FTS config below is built-in, no extra extension required.
create extension if not exists "vector";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'embed_status') then
    create type embed_status as enum ('pending', 'embedded', 'failed');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- 2.1 Spaces ---------------------------------------------------------------
create table if not exists public.spaces (
  id          text primary key,
  name        text        not null,
  description text        not null default '',
  color       text        not null default 'from-purple-600 via-pink-500 to-indigo-600',
  emoji       text        not null default '📁',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.spaces is 'Isolated knowledge bases used for RAG retrieval.';

-- 2.2 Documents ------------------------------------------------------------
create table if not exists public.documents (
  id          text primary key,
  space_id    text        not null references public.spaces (id) on delete cascade,
  name        text        not null,
  file_name   text        not null,
  mime_type   text        not null default 'text/plain',
  size        bigint      not null default 0,
  chunk_count integer     not null default 0,
  char_count  integer     not null default 0,
  content     text        not null default '',   -- full extracted text
  embedded    boolean     not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists documents_space_id_idx on public.documents (space_id);

-- 2.3 Document chunks ------------------------------------------------------
-- `embedding` uses the 768-dimension vector produced by `text-embedding-004`
-- (free Google AI Studio) or `text-embedding-3-small` (OpenAI, 1536 dims —
-- change the column type below if you use that model).
create table if not exists public.document_chunks (
  id             text primary key,
  document_id    text        not null references public.documents (id) on delete cascade,
  space_id       text        not null references public.spaces (id) on delete cascade,
  chunk_index    integer     not null default 0,
  content        text        not null,
  start_offset   integer     not null default 0,
  end_offset     integer     not null default 0,
  embedding      vector(768),
  embedding_model text,
  embed_status   embed_status not null default 'pending',
  created_at     timestamptz not null default now(),

  -- Full-text search vector, generated from `content`.
  tsv tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(content, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored
);

create index if not exists document_chunks_space_id_idx   on public.document_chunks (space_id);
create index if not exists document_chunks_document_id_idx on public.document_chunks (document_id);
create index if not exists document_chunks_tsv_idx        on public.document_chunks using gin (tsv);
create index if not exists document_chunks_embedding_idx  on public.document_chunks
  using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- 3. Chats (chat history sync)
-- ---------------------------------------------------------------------------
create table if not exists public.chats (
  id              text primary key,
  title           text        not null default 'New chat',
  messages        jsonb       not null default '[]'::jsonb,
  space_selection jsonb       not null default '{"kind":"none"}'::jsonb,
  model_id        text,
  pinned          boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists chats_updated_at_idx on public.chats (updated_at desc);

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
--    The app ships with the anon key only. Enable RLS and keep the policies
--    permissive for single-user workspaces, or add your own auth rules.
-- ---------------------------------------------------------------------------
alter table public.spaces         enable row level security;
alter table public.documents      enable row level security;
alter table public.document_chunks enable row level security;
alter table public.chats          enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['spaces', 'documents', 'document_chunks', 'chats']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_anon_all', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      t || '_anon_all', t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Hybrid retrieval functions
-- ---------------------------------------------------------------------------

-- 5.1 Vector search (pgvector cosine similarity) -----------------------------
-- Pass NULL in `filter_space_ids` to search every Space.
create or replace function public.match_document_chunks(
  query_embedding vector(768),
  match_count integer default 6,
  filter_space_ids text[] default null
)
returns table (
  id          text,
  document_id text,
  space_id    text,
  chunk_index integer,
  content     text,
  similarity  double precision
)
language sql
stable
as $$
  select
    c.id,
    c.document_id,
    c.space_id,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  where c.embedding is not null
    and (filter_space_ids is null or c.space_id = any (filter_space_ids))
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;

-- 5.2 Full-text search ------------------------------------------------------
create or replace function public.match_document_chunks_fts(
  query_text text,
  match_count integer default 6,
  filter_space_ids text[] default null
)
returns table (
  id          text,
  document_id text,
  space_id    text,
  chunk_index integer,
  content     text,
  rank        double precision
)
language sql
stable
as $$
  select
    c.id,
    c.document_id,
    c.space_id,
    c.chunk_index,
    c.content,
    ts_rank(c.tsv, websearch_to_tsquery('english', query_text)) as rank
  from public.document_chunks c
  where c.tsv @@ websearch_to_tsquery('english', query_text)
    and (filter_space_ids is null or c.space_id = any (filter_space_ids))
  order by rank desc
  limit greatest(1, least(match_count, 50));
$$;

-- 5.3 Hybrid search: vector + full-text, fused with reciprocal rank ---------
create or replace function public.match_document_chunks_hybrid(
  query_embedding vector(768),
  query_text text,
  match_count integer default 6,
  filter_space_ids text[] default null
)
returns table (
  id          text,
  document_id text,
  space_id    text,
  chunk_index integer,
  content     text,
  similarity  double precision,
  rank        double precision
)
language sql
stable
as $$
  with vector_hits as (
    select
      c.id,
      c.document_id,
      c.space_id,
      c.chunk_index,
      c.content,
      1 - (c.embedding <=> query_embedding) as similarity,
      row_number() over (order by c.embedding <=> query_embedding) as vector_rank
    from public.document_chunks c
    where c.embedding is not null
      and (filter_space_ids is null or c.space_id = any (filter_space_ids))
    order by c.embedding <=> query_embedding
    limit greatest(1, least(match_count, 50))
  ),
  fts_hits as (
    select
      c.id,
      ts_rank(c.tsv, websearch_to_tsquery('english', query_text)) as rank,
      row_number() over (
        order by ts_rank(c.tsv, websearch_to_tsquery('english', query_text)) desc
      ) as text_rank
    from public.document_chunks c
    where c.tsv @@ websearch_to_tsquery('english', query_text)
      and (filter_space_ids is null or c.space_id = any (filter_space_ids))
    limit greatest(1, least(match_count, 50))
  )
  select
    v.id,
    v.document_id,
    v.space_id,
    v.chunk_index,
    v.content,
    v.similarity,
    coalesce(f.rank, 0)
  from vector_hits v
  left join fts_hits f on f.id = v.id
  order by (1.0 / (60 + v.vector_rank)) + coalesce(1.0 / (60 + f.text_rank), 0) desc
  limit greatest(1, least(match_count, 50));
$$;

-- ---------------------------------------------------------------------------
-- 6. Storage bucket: `spaces-files`
-- ---------------------------------------------------------------------------
-- Option A — run this block in the Supabase SQL editor:
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'spaces-files',
  'spaces-files',
  true,
  26214400,  -- 25 MB
  array[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'application/octet-stream'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Storage policies (idempotent).
drop policy if exists spaces_files_read   on storage.objects;
drop policy if exists spaces_files_insert on storage.objects;
drop policy if exists spaces_files_update on storage.objects;
drop policy if exists spaces_files_delete on storage.objects;

create policy "spaces_files_read"   on storage.objects for select to anon, authenticated using (bucket_id = 'spaces-files');
create policy "spaces_files_insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'spaces-files');
create policy "spaces_files_update" on storage.objects for update to anon, authenticated using (bucket_id = 'spaces-files');
create policy "spaces_files_delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'spaces-files');

-- Option B — create the bucket from the dashboard instead:
--   Dashboard → Storage → New bucket → name: `spaces-files` → Public.
--
-- ---------------------------------------------------------------------------
-- 7. Convenience view: chunk count per space
-- ---------------------------------------------------------------------------
create or replace view public.space_stats as
select
  s.id                as space_id,
  s.name              as space_name,
  s.emoji             as space_emoji,
  count(distinct d.id)   as document_count,
  count(c.id)            as chunk_count,
  coalesce(sum(d.char_count), 0)::bigint as char_count
from public.spaces s
left join public.documents d       on d.space_id = s.id
left join public.document_chunks c on c.space_id = s.id
group by s.id, s.name, s.emoji;

-- ---------------------------------------------------------------------------
-- 8. Client configuration
-- ---------------------------------------------------------------------------
-- Add these to `.env.local` (then redeploy):
--
--   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
--   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
--
-- Notes
--  * The anon key is safe to expose in the browser; RLS governs access.
--  * If you enable Supabase Auth, tighten the policies created in section 4
--    to `auth.uid() = user_id` and add a `user_id uuid` column to each table.
--  * pgvector HNSW indexes are supported on the free tier; keep the table
--    under a few hundred thousand chunks to stay comfortably in budget.
-- ===========================================================================
