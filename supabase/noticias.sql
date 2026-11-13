-- Moxetas Invest: activos extra para las noticias. Pegar en Supabase › SQL Editor › New query › Run (una vez).
-- La app apunta aquí los activos que sigues o tienes y que no están en la lista fija de noticias (solo nombre,
-- símbolo e ISIN; nada de cantidades ni de quién lo pide). La tarea de noticias de GitHub los lee cada hora.

create table public.news_topics (
  key text primary key check (key ~ '^[A-Z0-9_.!-]{1,20}:[A-Z0-9_.!/-]{1,30}$'),
  name text not null check (char_length(name) between 2 and 60),
  isin text check (isin is null or isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  ticker text check (ticker is null or char_length(ticker) <= 30),
  last_seen timestamptz not null default now()
);
alter table public.news_topics enable row level security;
create policy "cualquiera puede leer" on public.news_topics for select to anon, authenticated using (true);
grant select on public.news_topics to anon, authenticated;

create or replace function public.request_news(p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare x jsonb; n int := 0;
begin
  if auth.uid() is null then return; end if;
  for x in select * from jsonb_array_elements(p_items) limit 40 loop
    begin
      if (select count(*) from news_topics) >= 400 and not exists (select 1 from news_topics where key = upper(x ->> 'key')) then continue; end if;
      insert into news_topics (key, name, isin, ticker)
        values (upper(x ->> 'key'), left(trim(x ->> 'name'), 60), nullif(upper(x ->> 'isin'), ''), nullif(upper(x ->> 'ticker'), ''))
        on conflict (key) do update set last_seen = now(), name = excluded.name, isin = coalesce(excluded.isin, news_topics.isin);
    exception when check_violation then null;   -- se ignora lo que no tenga buena pinta
    end;
  end loop;
  delete from news_topics where last_seen < now() - interval '60 days';
end $$;
revoke execute on function public.request_news(jsonb) from public, anon;
grant execute on function public.request_news(jsonb) to authenticated;
