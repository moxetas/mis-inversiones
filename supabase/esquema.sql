-- Pegar entero en Supabase › SQL Editor › New query › Run (solo una vez).
-- Moxetas Invest: grupos con ranking y chat. Solo se guarda apodo, rentabilidad y mensajes.
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null check (char_length(name) between 1 and 40),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create table public.members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  nickname text not null check (char_length(nickname) between 1 and 24),
  pct numeric,
  gain numeric,
  show_gain boolean not null default false,
  updated_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create table public.messages (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  nickname text not null check (char_length(nickname) between 1 and 24),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index on public.messages (group_id, created_at desc);

alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.messages enable row level security;

-- ¿Soy miembro de este grupo?
create or replace function public.is_member(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where group_id = g and user_id = auth.uid());
$$;

-- Crear un grupo (te une a él) y unirse con un código
create or replace function public.create_group(p_name text, p_nickname text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  if auth.uid() is null then raise exception 'sin sesión'; end if;
  insert into groups (code, name, created_by)
    values ('MX-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)), p_name, auth.uid())
    returning * into g;
  insert into members (group_id, user_id, nickname) values (g.id, auth.uid(), p_nickname);
  return g;
end $$;
create or replace function public.join_group(p_code text, p_nickname text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  if auth.uid() is null then raise exception 'sin sesión'; end if;
  select * into g from groups where code = upper(trim(p_code));
  if g.id is null then raise exception 'código no válido'; end if;
  insert into members (group_id, user_id, nickname) values (g.id, auth.uid(), p_nickname)
    on conflict (group_id, user_id) do update set nickname = excluded.nickname;
  return g;
end $$;

-- Reglas: solo los miembros ven el grupo, su ranking y su chat; cada uno solo cambia lo suyo
create policy "ver mis grupos" on public.groups for select to authenticated using (public.is_member(id));
create policy "ver miembros de mis grupos" on public.members for select to authenticated using (public.is_member(group_id));
create policy "actualizar lo mío" on public.members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "salir del grupo" on public.members for delete to authenticated using (user_id = auth.uid());
create policy "leer el chat de mis grupos" on public.messages for select to authenticated using (public.is_member(group_id));
create policy "escribir en mis grupos" on public.messages for insert to authenticated with check (user_id = auth.uid() and public.is_member(group_id));

grant usage on schema public to anon, authenticated;
grant select on public.groups to authenticated;
grant select, update, delete on public.members to authenticated;
grant select, insert on public.messages to authenticated;
revoke execute on function public.create_group(text, text), public.join_group(text, text), public.is_member(uuid) from public, anon;
grant execute on function public.create_group(text, text), public.join_group(text, text), public.is_member(uuid) to authenticated;

-- Tiempo real para el chat y el ranking
alter publication supabase_realtime add table public.messages, public.members;
