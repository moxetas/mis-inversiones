-- Moxetas Invest: retos dentro del grupo. Pegar entero en Supabase › SQL Editor › New query › Run (una sola vez,
-- después de esquema.sql). Cada participante elige activos antes de empezar; gana quien más sube (media de sus activos).
-- Los precios de inicio y de final los guarda el propio servidor (pg_cron + pg_net), así nadie puede hacer trampas.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table public.games (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  start_at timestamptz not null,
  end_at timestamptz not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  start_tries int not null default 0,
  end_tries int not null default 0,
  check (end_at > start_at)
);
create index on public.games (group_id);

create table public.picks (
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  nickname text not null check (char_length(nickname) between 1 and 24),
  assets jsonb not null check (jsonb_typeof(assets) = 'array' and jsonb_array_length(assets) between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

create table public.game_prices (
  game_id uuid not null references public.games(id) on delete cascade,
  symbol text not null,
  start_price numeric,
  end_price numeric,
  start_src text,
  end_src text,
  primary key (game_id, symbol)
);

-- Peticiones a TradingView pendientes de respuesta (solo las usa el servidor)
create table public.game_requests (
  id bigint primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  kind text not null check (kind in ('start', 'end')),
  created_at timestamptz not null default now()
);

alter table public.games enable row level security;
alter table public.picks enable row level security;
alter table public.game_prices enable row level security;
alter table public.game_requests enable row level security;

-- ¿Soy del grupo de este reto? / ¿Se puede todavía elegir? / ¿Ya ha empezado?
create or replace function public.game_member(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from games g join members m on m.group_id = g.group_id
                 where g.id = p_game and m.user_id = auth.uid());
$$;
create or replace function public.game_open(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from games g where g.id = p_game and g.start_at > now()) and public.game_member(p_game);
$$;
create or replace function public.game_started(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from games g where g.id = p_game and g.start_at <= now()) and public.game_member(p_game);
$$;

-- Crear un reto
create or replace function public.create_game(p_group uuid, p_name text, p_start timestamptz, p_end timestamptz) returns public.games
language plpgsql security definer set search_path = public as $$
declare g games;
begin
  if not public.is_member(p_group) then raise exception 'no eres del grupo'; end if;
  if p_start < now() + interval '5 minutes' then raise exception 'el reto tiene que empezar más tarde'; end if;
  if p_end <= p_start or p_end > p_start + interval '2 years' then raise exception 'duración no válida'; end if;
  insert into games (group_id, name, start_at, end_at, created_by) values (p_group, p_name, p_start, p_end, auth.uid()) returning * into g;
  return g;
end $$;

-- Quién se ha apuntado (antes de empezar no se ve qué ha elegido cada uno, solo cuántos activos)
create or replace function public.game_players(p_game uuid) returns table (user_id uuid, nickname text, n int)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.nickname, jsonb_array_length(p.assets) from picks p where p.game_id = p_game and public.game_member(p_game);
$$;

-- Plan B: si el servidor no ha podido guardar algún precio 15 minutos después, lo manda la app
create or replace function public.fill_prices(p_game uuid, p_kind text, p_prices jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare g games; k text; v numeric;
begin
  select * into g from games where id = p_game;
  if g.id is null or not public.game_member(p_game) then raise exception 'no permitido'; end if;
  if (p_kind = 'start' and now() < g.start_at + interval '15 minutes') or (p_kind = 'end' and now() < g.end_at + interval '15 minutes')
     or p_kind not in ('start', 'end') then return; end if;
  for k, v in select key, value::text::numeric from jsonb_each(p_prices) loop
    if v > 0 then
      if p_kind = 'start' then update game_prices set start_price = v, start_src = 'app' where game_id = p_game and symbol = k and start_price is null;
      else update game_prices set end_price = v, end_src = 'app' where game_id = p_game and symbol = k and end_price is null; end if;
    end if;
  end loop;
end $$;

-- Cada minuto: guarda los precios de los retos que empiezan o acaban (pide a TradingView y lee la respuesta)
create or replace function public.game_tick() returns void
language plpgsql security definer set search_path = public as $$
declare r record; x jsonb; px numeric; v_id bigint; v_body jsonb; mk text;
begin
  -- 1) Leer respuestas que ya han llegado
  for r in select q.id, q.game_id, q.kind, h.status_code, h.content
           from game_requests q join net._http_response h on h.id = q.id loop
    if r.status_code = 200 and r.content is not null then
      for x in select * from jsonb_array_elements(coalesce(r.content::jsonb -> 'data', '[]'::jsonb)) loop
        px := (x -> 'd' ->> 0)::numeric;
        if px is not null and px > 0 then
          if r.kind = 'start' then
            update game_prices set start_price = px, start_src = 'servidor' where game_id = r.game_id and symbol = x ->> 's' and start_price is null;
          else
            update game_prices set end_price = px, end_src = 'servidor' where game_id = r.game_id and symbol = x ->> 's' and end_price is null;
          end if;
        end if;
      end loop;
    end if;
    delete from game_requests where id = r.id;
  end loop;
  delete from game_requests where created_at < now() - interval '10 minutes';

  -- 2) Al empezar, apuntar los activos elegidos (ya no se pueden cambiar)
  insert into game_prices (game_id, symbol)
    select distinct p.game_id, a ->> 's' from picks p join games g on g.id = p.game_id
    cross join jsonb_array_elements(p.assets) a
    where g.start_at <= now() and g.start_tries = 0 and coalesce(a ->> 's', '') <> ''
  on conflict do nothing;

  -- 3) Pedir los precios que faltan (como mucho 6 intentos)
  for r in select g.id, 'start'::text as kind from games g where g.start_at <= now() and g.start_tries < 6
             and exists (select 1 from game_prices p where p.game_id = g.id and p.start_price is null)
           union all
           select g.id, 'end'::text from games g where g.end_at <= now() and g.end_tries < 6
             and exists (select 1 from game_prices p where p.game_id = g.id and p.end_price is null) loop
    if exists (select 1 from game_requests q where q.game_id = r.id and q.kind = r.kind) then continue; end if;
    v_body := jsonb_build_object('columns', jsonb_build_array('close'), 'symbols', jsonb_build_object('tickers',
      (select jsonb_agg(symbol) from game_prices where game_id = r.id and (case when r.kind = 'start' then start_price else end_price end) is null)));
    foreach mk in array array['global', 'germany', 'spain'] loop
      v_id := net.http_post(url := 'https://scanner.tradingview.com/' || mk || '/scan', body := v_body,
                            headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 10000);
      insert into game_requests (id, game_id, kind) values (v_id, r.id, r.kind);
    end loop;
    if r.kind = 'start' then update games set start_tries = start_tries + 1 where id = r.id;
    else update games set end_tries = end_tries + 1 where id = r.id; end if;
  end loop;
  -- Retos que empezaron sin nadie apuntado
  update games set start_tries = 6 where start_at <= now() and start_tries = 0 and not exists (select 1 from picks p where p.game_id = games.id);
end $$;

-- Reglas
create policy "ver retos de mis grupos" on public.games for select to authenticated using (public.is_member(group_id));
create policy "borrar mis retos" on public.games for delete to authenticated using (created_by = auth.uid());
create policy "ver elecciones" on public.picks for select to authenticated using (user_id = auth.uid() or public.game_started(game_id));
create policy "elegir" on public.picks for insert to authenticated with check (user_id = auth.uid() and public.game_open(game_id));
create policy "cambiar elección" on public.picks for update to authenticated using (user_id = auth.uid() and public.game_open(game_id)) with check (user_id = auth.uid() and public.game_open(game_id));
create policy "borrar elección" on public.picks for delete to authenticated using (user_id = auth.uid() and public.game_open(game_id));
create policy "ver precios del reto" on public.game_prices for select to authenticated using (public.game_member(game_id));

grant select, delete on public.games to authenticated;
grant select, insert, update, delete on public.picks to authenticated;
grant select on public.game_prices to authenticated;
revoke all on public.game_requests from anon, authenticated;
revoke execute on function public.game_member(uuid), public.game_open(uuid), public.game_started(uuid),
  public.create_game(uuid, text, timestamptz, timestamptz), public.game_players(uuid), public.fill_prices(uuid, text, jsonb),
  public.game_tick() from public, anon;
grant execute on function public.game_member(uuid), public.game_open(uuid), public.game_started(uuid),
  public.create_game(uuid, text, timestamptz, timestamptz), public.game_players(uuid), public.fill_prices(uuid, text, jsonb) to authenticated;

alter publication supabase_realtime add table public.games, public.game_prices;

select cron.schedule('retos-precios', '* * * * *', 'select public.game_tick()');
