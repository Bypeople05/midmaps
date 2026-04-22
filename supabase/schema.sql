create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.mindmaps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  map_data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workspace_members_user_id on public.workspace_members(user_id);
create index if not exists idx_workspace_members_workspace_id on public.workspace_members(workspace_id);
create index if not exists idx_mindmaps_workspace_id on public.mindmaps(workspace_id);
create index if not exists idx_mindmaps_updated_at on public.mindmaps(updated_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mindmaps_touch_updated_at on public.mindmaps;
create trigger mindmaps_touch_updated_at
before update on public.mindmaps
for each row execute function public.touch_updated_at();

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner', 'admin')
  );
$$;

create or replace function public.add_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (workspace_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_add_owner on public.workspaces;
create trigger workspaces_add_owner
after insert on public.workspaces
for each row execute function public.add_workspace_owner();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.mindmaps enable row level security;

drop policy if exists "workspaces_select_members" on public.workspaces;
create policy "workspaces_select_members"
on public.workspaces for select
using (public.is_workspace_member(id));

drop policy if exists "workspaces_insert_authenticated" on public.workspaces;
create policy "workspaces_insert_authenticated"
on public.workspaces for insert
with check (auth.uid() is not null and created_by = auth.uid());

drop policy if exists "workspaces_update_admins" on public.workspaces;
create policy "workspaces_update_admins"
on public.workspaces for update
using (public.is_workspace_admin(id))
with check (public.is_workspace_admin(id));

drop policy if exists "workspace_members_select_related" on public.workspace_members;
create policy "workspace_members_select_related"
on public.workspace_members for select
using (user_id = auth.uid() or public.is_workspace_admin(workspace_id));

drop policy if exists "workspace_members_manage_admins" on public.workspace_members;
create policy "workspace_members_manage_admins"
on public.workspace_members for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists "mindmaps_select_members" on public.mindmaps;
create policy "mindmaps_select_members"
on public.mindmaps for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "mindmaps_insert_members" on public.mindmaps;
create policy "mindmaps_insert_members"
on public.mindmaps for insert
with check (public.is_workspace_member(workspace_id));

drop policy if exists "mindmaps_update_members" on public.mindmaps;
create policy "mindmaps_update_members"
on public.mindmaps for update
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "mindmaps_delete_admins" on public.mindmaps;
create policy "mindmaps_delete_admins"
on public.mindmaps for delete
using (public.is_workspace_admin(workspace_id));
