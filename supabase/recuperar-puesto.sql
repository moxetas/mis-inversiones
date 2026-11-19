-- Moxetas Invest: recuperar tu puesto en el grupo y tus retos después de que el móvil borrara la app.
-- Antes: vuelve a unirte al grupo con el código y EXACTAMENTE el mismo apodo que tenías.
-- Después pega esto en Supabase › SQL Editor › New query › Run. Junta el puesto antiguo con el nuevo
-- (mismo apodo en el mismo grupo): tus activos de los retos, los retos que creaste y el grupo pasan al nuevo.

drop table if exists dup;
create temp table dup as
select o.group_id, o.user_id as old_id, n.user_id as new_id, n.nickname
from public.members o
join public.members n on n.group_id = o.group_id
  and lower(trim(n.nickname)) = lower(trim(o.nickname))
  and n.joined_at > o.joined_at
  and n.user_id <> o.user_id;

update public.picks p set user_id = d.new_id
from dup d, public.games g
where g.group_id = d.group_id and p.game_id = g.id and p.user_id = d.old_id
  and not exists (select 1 from public.picks x where x.game_id = p.game_id and x.user_id = d.new_id);

update public.games g set created_by = d.new_id from dup d where g.group_id = d.group_id and g.created_by = d.old_id;
update public.groups gr set created_by = d.new_id from dup d where gr.id = d.group_id and gr.created_by = d.old_id;
delete from public.members m using dup d where m.group_id = d.group_id and m.user_id = d.old_id;

select nickname as recuperado from dup;
drop table dup;
