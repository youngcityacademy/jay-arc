-- Run this migration in the Supabase SQL Editor as the project owner.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  full_name text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,24}$')
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

create table if not exists public.user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.profiles enable row level security;
alter table public.user_data enable row level security;

do $policy_cleanup$
declare
  existing_policy record;
begin
  for existing_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'user_data')
  loop
    execute format(
      'drop policy %I on %I.%I',
      existing_policy.policyname,
      existing_policy.schemaname,
      existing_policy.tablename
    );
  end loop;
end
$policy_cleanup$;

revoke all on public.profiles from public, anon, authenticated;
revoke all on public.user_data from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, full_name) on public.profiles to authenticated;
grant select on public.user_data to authenticated;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Active users can update their own profile"
  on public.profiles for update to authenticated
  using (
    id = (select auth.uid())
    and is_active
  )
  with check (
    id = (select auth.uid())
    and is_active
  );

create policy "Active users can read their own data"
  on public.user_data for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_active
    )
  );

create policy "Active users can create their own data"
  on public.user_data for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_active
    )
  );

create policy "Active users can update their own data"
  on public.user_data for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_active
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_active
    )
  );

create policy "Active users can delete their own data"
  on public.user_data for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_active
    )
  );

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists user_data_set_updated_at on public.user_data;
create trigger user_data_set_updated_at
  before update on public.user_data
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  requested_name text;
begin
  requested_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  requested_name := trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  if requested_username !~ '^[a-z0-9_]{3,24}$' or requested_name = '' then
    raise exception 'A valid username and full name are required';
  end if;

  insert into public.profiles (id, username, full_name)
  values (new.id, requested_username, requested_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.save_user_data(
  p_data jsonb,
  p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_at timestamptz;
begin
  if auth.uid() is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'A signed-in user and valid data object are required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
  ) then
    raise exception 'An active account is required';
  end if;

  if p_expected_updated_at is null then
    insert into public.user_data (user_id, data)
    values (auth.uid(), p_data)
    on conflict (user_id) do nothing
    returning updated_at into saved_at;
    return saved_at;
  end if;

  update public.user_data
  set data = p_data, updated_at = clock_timestamp()
  where user_id = auth.uid()
    and updated_at = p_expected_updated_at
  returning updated_at into saved_at;
  return saved_at;
end;
$$;

revoke all on function public.save_user_data(jsonb, timestamptz) from public, anon;
grant execute on function public.save_user_data(jsonb, timestamptz) to authenticated;

create or replace function public.admin_list_users()
returns table (
  id uuid,
  username text,
  full_name text,
  role text,
  is_active boolean,
  created_at timestamptz,
  email text,
  record_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.is_active
  ) then
    raise exception 'Administrator access is required';
  end if;

  return query
  select p.id, p.username, p.full_name, p.role, p.is_active, p.created_at,
    u.email::text,
    (
      case when jsonb_typeof(d.data -> 'days') = 'object'
        then jsonb_object_length(d.data -> 'days') else 0 end
      + case when jsonb_typeof(d.data -> 'savings') = 'array'
        then jsonb_array_length(d.data -> 'savings') else 0 end
      + case when jsonb_typeof(d.data -> 'learningGoals') = 'array'
        then jsonb_array_length(d.data -> 'learningGoals') else 0 end
      + case when jsonb_typeof(d.data -> 'videoIdeas') = 'array'
        then jsonb_array_length(d.data -> 'videoIdeas') else 0 end
      + case when jsonb_typeof(d.data -> 'footballSchedule') = 'array'
        then jsonb_array_length(d.data -> 'footballSchedule') else 0 end
    )::bigint
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.user_data d on d.user_id = p.id
  order by p.created_at desc;
end;
$$;

create or replace function public.admin_set_user_active(
  p_user_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.is_active
  ) then
    raise exception 'Administrator access is required';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Administrators cannot disable their own account';
  end if;

  update public.profiles
  set is_active = p_is_active
  where id = p_user_id;
  if not found then
    raise exception 'Account not found';
  end if;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_set_user_active(uuid, boolean) from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;

-- Promote an administrator manually in the Supabase SQL Editor after signup:
-- update public.profiles set role = 'admin' where id = '<auth.users UUID>';
