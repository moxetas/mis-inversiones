-- Moxetas Invest: copia automática en la nube. Pegar en Supabase › SQL Editor › New query › Run (una vez).
-- Cada cuenta guarda UNA copia de sus datos, cifrada en el móvil con su contraseña: en el servidor solo hay
-- texto ilegible. Nadie más que el dueño puede leer ni cambiar su fila.

create table public.backups (
  user_id uuid primary key default auth.uid(),
  data text not null check (char_length(data) <= 3000000),
  iv text not null,
  updated_at timestamptz not null default now()
);
alter table public.backups enable row level security;
create policy "mi copia: leer" on public.backups for select to authenticated using (user_id = auth.uid());
create policy "mi copia: crear" on public.backups for insert to authenticated with check (user_id = auth.uid());
create policy "mi copia: cambiar" on public.backups for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "mi copia: borrar" on public.backups for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.backups to authenticated;
