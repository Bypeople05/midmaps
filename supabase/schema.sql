create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  app_role text not null default 'client' check (app_role in ('admin', 'client')),
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

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);

create index if not exists idx_workspace_members_user_id on public.workspace_members(user_id);
create index if not exists idx_workspace_members_workspace_id on public.workspace_members(workspace_id);
create index if not exists idx_mindmaps_workspace_id on public.mindmaps(workspace_id);
create index if not exists idx_mindmaps_updated_at on public.mindmaps(updated_at desc);
create index if not exists idx_workspace_invites_email on public.workspace_invites(lower(email));
create index if not exists idx_workspace_invites_workspace_id on public.workspace_invites(workspace_id);

alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists app_role text not null default 'client';
alter table public.profiles add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_app_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_app_role_check check (app_role in ('admin', 'client'));
  end if;
end $$;

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

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.app_role = 'admin'
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
  ) or public.is_app_admin();
$$;

create or replace function public.add_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, app_role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'client')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists auth_add_user_profile on auth.users;
create trigger auth_add_user_profile
after insert on auth.users
for each row execute function public.add_user_profile();

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

create or replace function public.create_workspace_with_member(workspace_name text)
returns table (
  id uuid,
  name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace public.workspaces;
begin
  if auth.uid() is null then
    raise exception 'Login obrigatorio para criar cliente.';
  end if;

  if not public.is_app_admin() then
    raise exception 'Apenas administradores podem criar clientes.';
  end if;

  if trim(coalesce(workspace_name, '')) = '' then
    raise exception 'Nome do cliente e obrigatorio.';
  end if;

  insert into public.workspaces (name, created_by)
  values (trim(workspace_name), auth.uid())
  returning * into new_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace.id, auth.uid(), 'owner')
  on conflict (workspace_id, user_id) do nothing;

  return query
  select new_workspace.id, new_workspace.name, new_workspace.created_at;
end;
$$;

drop trigger if exists workspaces_add_owner on public.workspaces;
create trigger workspaces_add_owner
after insert on public.workspaces
for each row execute function public.add_workspace_owner();

create or replace function public.accept_workspace_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted_count integer;
  current_email text;
begin
  current_email := lower(coalesce(auth.jwt()->>'email', ''));

  if auth.uid() is null or current_email = '' then
    return 0;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  select wi.workspace_id, auth.uid(), wi.role
  from public.workspace_invites wi
  where lower(wi.email) = current_email
    and wi.accepted_at is null
  on conflict (workspace_id, user_id)
  do update set role = excluded.role;

  get diagnostics accepted_count = row_count;

  update public.workspace_invites wi
  set accepted_at = now()
  where lower(wi.email) = current_email
    and wi.accepted_at is null;

  return accepted_count;
end;
$$;

grant execute on function public.accept_workspace_invites() to authenticated;
grant execute on function public.create_workspace_with_member(text) to authenticated;

alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.workspace_members enable row level security;
alter table public.mindmaps enable row level security;
alter table public.workspace_invites enable row level security;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
on public.profiles for select
using (id = auth.uid() or public.is_app_admin());

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles for insert
with check (id = auth.uid() and app_role = 'client');

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid() and app_role = (select p.app_role from public.profiles p where p.id = auth.uid()));

drop policy if exists "workspaces_select_members" on public.workspaces;
create policy "workspaces_select_members"
on public.workspaces for select
using (public.is_workspace_member(id) or public.is_app_admin());

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
using (user_id = auth.uid() or public.is_workspace_admin(workspace_id) or public.is_app_admin());

drop policy if exists "workspace_members_manage_admins" on public.workspace_members;
create policy "workspace_members_manage_admins"
on public.workspace_members for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists "workspace_invites_select_related" on public.workspace_invites;
create policy "workspace_invites_select_related"
on public.workspace_invites for select
using (
  public.is_workspace_admin(workspace_id)
  or lower(email) = lower(coalesce(auth.jwt()->>'email', ''))
  or public.is_app_admin()
);

drop policy if exists "workspace_invites_manage_admins" on public.workspace_invites;
create policy "workspace_invites_manage_admins"
on public.workspace_invites for all
using (public.is_workspace_admin(workspace_id) or public.is_app_admin())
with check (public.is_workspace_admin(workspace_id) or public.is_app_admin());

drop policy if exists "mindmaps_select_members" on public.mindmaps;
create policy "mindmaps_select_members"
on public.mindmaps for select
using (public.is_workspace_member(workspace_id) or public.is_app_admin());

drop policy if exists "mindmaps_insert_members" on public.mindmaps;
create policy "mindmaps_insert_members"
on public.mindmaps for insert
with check (public.is_workspace_member(workspace_id) or public.is_app_admin());

drop policy if exists "mindmaps_update_members" on public.mindmaps;
create policy "mindmaps_update_members"
on public.mindmaps for update
using (public.is_workspace_member(workspace_id) or public.is_app_admin())
with check (public.is_workspace_member(workspace_id) or public.is_app_admin());

drop policy if exists "mindmaps_delete_admins" on public.mindmaps;
create policy "mindmaps_delete_admins"
on public.mindmaps for delete
using (public.is_workspace_admin(workspace_id) or public.is_app_admin());
