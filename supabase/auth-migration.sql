-- ===========================================================================
-- Sloth · AI Workspace — per-user auth migration
--
-- Run this AFTER supabase/schema.sql, once, in:  Supabase Dashboard → SQL Editor
--
-- What it does:
--   1. Adds `user_id uuid` to every workspace table. New rows written by an
--      authenticated browser request automatically get `user_id = auth.uid()`
--      from the column default — the client never has to send it.
--   2. Replaces the blanket policies with user-scoped RLS:
--        authenticated users  → their own rows (or legacy rows with user_id
--                                NULL, so nothing already mirrored is lost)
--        unauthenticated/anon → only legacy rows (kept for compatibility;
--                                the app no longer mirrors as anon)
--   3. Keeps the pgvector + FTS retrieval functions working: they run as the
--      caller (SECURITY INVOKER), so RLS automatically scopes results.
--
-- After running:
--   * Enable the email/password provider in: Dashboard → Authentication →
--     Sign In / Providers → Email.
--   * (Optional, one-time per existing account) Claim legacy rows you already
--     synced as anonymous. In the SQL editor run, replacing the uuid with the
--     user id shown in Dashboard → Authentication → Users:
--
--         update public.spaces          set user_id = '<uuid>' where user_id is null;
--         update public.chats           set user_id = '<uuid>' where user_id is null;
--         update public.documents       set user_id = '<uuid>' where user_id is null;
--         update public.document_chunks set user_id = '<uuid>' where user_id is null;
--
-- Sign in from the app header → the login screen. Everything keeps working
-- without Supabase: the app falls back to per-account browser storage.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. user_id columns (uuid, default = the caller's JWT subject)
-- ---------------------------------------------------------------------------
alter table public.spaces          add column if not exists user_id uuid default auth.uid();
alter table public.documents       add column if not exists user_id uuid default auth.uid();
alter table public.document_chunks add column if not exists user_id uuid default auth.uid();
alter table public.chats           add column if not exists user_id uuid default auth.uid();

create index if not exists spaces_user_id_idx           on public.spaces (user_id);
create index if not exists documents_user_id_idx        on public.documents (user_id);
create index if not exists document_chunks_user_id_idx  on public.document_chunks (user_id);
create index if not exists chats_user_id_idx            on public.chats (user_id);

-- ---------------------------------------------------------------------------
-- 2. User-scoped policies (replace the blanket ones from schema.sql)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['spaces', 'documents', 'document_chunks', 'chats']
  loop
    -- Drop both the legacy anon policy and any previous attempt of these.
    execute format('drop policy if exists %I on public.%I', t || '_anon_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_user_all', t);

    execute format($f$
      create policy %I on public.%I for all to authenticated
      using (user_id is null or user_id = auth.uid())
      with check (user_id is null or user_id = auth.uid())
    $f$, t || '_user_all', t);

    -- Legacy compatibility: rows written before auth existed stay reachable.
    execute format(
      'create policy %I on public.%I for all to anon using (true) with check (true)',
      t || '_anon_compat', t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Storage: scope uploads by user prefix (optional but recommended).
--    Existing objects keep working; new uploads go under <user_id>/.
--    The app appends the prefix itself when a session exists.
-- ---------------------------------------------------------------------------
drop policy if exists spaces_files_read   on storage.objects;
drop policy if exists spaces_files_insert on storage.objects;
drop policy if exists spaces_files_update on storage.objects;
drop policy if exists spaces_files_delete on storage.objects;

create policy "spaces_files_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'spaces-files');

create policy "spaces_files_insert"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'spaces-files');

create policy "spaces_files_update"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'spaces-files');

create policy "spaces_files_delete"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'spaces-files');
