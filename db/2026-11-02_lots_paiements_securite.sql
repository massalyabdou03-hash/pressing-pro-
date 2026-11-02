-- Pressing Pro · 2 nov. 2026
-- Lots de lavage, numéros de paiement, annulation de paiement, renforcement de la sécurité.

/* ---------- 1. Droits : on ne garde que ce que l'app utilise ---------- */
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
revoke insert, update, delete on public.pressings from authenticated;
grant update (name, phone, address, settings) on public.pressings to authenticated;
revoke insert, update on public.members from authenticated;
revoke delete on public.customers from authenticated;
-- paiements : le numéro et l'annulation sont posés par la base, jamais par le téléphone
revoke insert on public.payments from authenticated;
grant insert (id, order_id, pressing_id, amount, method, created_by, created_at) on public.payments to authenticated;

/* ---------- 2. Code équipe : 8 caractères, essais limités, régénérable ---------- */
create or replace function public.gen_join_code() returns text
language plpgsql set search_path = '' as $$
declare a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; b bytea := extensions.gen_random_bytes(8); r text := ''; i int;
begin
  for i in 0..7 loop r := r || substr(a, 1 + (get_byte(b, i) % 31), 1); end loop;
  return r;
end $$;
alter table public.pressings alter column join_code set default public.gen_join_code();
update public.pressings set join_code = public.gen_join_code();

create table if not exists public.join_attempts (
  user_id uuid not null,
  ok boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists join_attempts_user_idx on public.join_attempts (user_id, at desc);
create index if not exists join_attempts_at_idx on public.join_attempts (at desc);
alter table public.join_attempts enable row level security;
revoke all on public.join_attempts from anon, authenticated;

create or replace function public.join_pressing(p_code text, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare pid uuid; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Non connecté'; end if;
  if exists(select 1 from public.members where user_id = uid) then raise exception 'Ce compte appartient déjà à un pressing'; end if;
  if (select count(*) from public.join_attempts where user_id = uid and not ok and at > now() - interval '1 hour') >= 5
    then raise exception 'Trop d''essais avec un mauvais code. Réessaie dans une heure.'; end if;
  if (select count(*) from public.join_attempts where not ok and at > now() - interval '1 hour') >= 300
    then raise exception 'Service momentanément limité. Réessaie plus tard.'; end if;
  select id into pid from public.pressings where join_code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  insert into public.join_attempts(user_id, ok) values (uid, pid is not null);
  delete from public.join_attempts where at < now() - interval '2 days';
  -- code faux : on renvoie null (pas d'exception, sinon l'essai ne serait pas compté)
  if pid is null then return null; end if;
  insert into public.members(pressing_id, user_id, role, display_name) values (pid, uid, 'staff', left(trim(coalesce(p_name, '')), 60));
  return pid;
end $$;

create or replace function public.regen_join_code(p_pressing uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if not public.is_owner(p_pressing) then raise exception 'Seul le gérant peut changer le code'; end if;
  update public.pressings set join_code = public.gen_join_code() where id = p_pressing returning join_code into c;
  return c;
end $$;

-- un employé retiré ne peut pas revenir avec l'ancien code
create or replace function public.members_after_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'staff' then update public.pressings set join_code = public.gen_join_code() where id = old.pressing_id; end if;
  return null;
end $$;
drop trigger if exists members_regen_code on public.members;
create trigger members_regen_code after delete on public.members for each row execute function public.members_after_delete();

/* ---------- 3. Catalogue : réservé au gérant ---------- */
drop policy if exists gt_insert on public.garment_types;
drop policy if exists gt_update on public.garment_types;
drop policy if exists gt_delete on public.garment_types;
create policy gt_insert on public.garment_types for insert to authenticated with check (public.is_owner(pressing_id) and public.can_write(pressing_id));
create policy gt_update on public.garment_types for update to authenticated using (public.is_owner(pressing_id) and public.can_write(pressing_id)) with check (public.is_owner(pressing_id) and public.can_write(pressing_id));
create policy gt_delete on public.garment_types for delete to authenticated using (public.is_owner(pressing_id) and public.can_write(pressing_id));

/* ---------- 4. Paiements : numéro, annulation, contrôles ---------- */
alter table public.pressings add column if not exists next_payment int not null default 1;
alter table public.pressings add column if not exists next_lot int not null default 1;
alter table public.payments add column if not exists number int;
alter table public.payments add column if not exists voided_at timestamptz;
alter table public.payments add column if not exists voided_by uuid;
alter table public.payments add column if not exists void_reason text not null default '';

with x as (select id, row_number() over (partition by pressing_id order by created_at, id) rn from public.payments)
update public.payments p set number = x.rn from x where x.id = p.id and p.number is null;
update public.pressings p set next_payment = coalesce((select max(number) from public.payments where pressing_id = p.id), 0) + 1;
alter table public.payments alter column number set not null;
create unique index if not exists payments_pressing_number_uq on public.payments (pressing_id, number);

create or replace function public.payments_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare tot int; st text; already int;
begin
  -- rejeu d'un paiement déjà enregistré (hors connexion) : on laisse la clé primaire refuser le doublon
  if exists(select 1 from public.payments where id = new.id) then
    select number into new.number from public.payments where id = new.id;
    return new;
  end if;
  select o.total, o.status into tot, st from public.orders o where o.id = new.order_id for update;
  if st = 'annule' then raise exception 'Ticket annulé : paiement impossible'; end if;
  select coalesce(sum(amount), 0) into already from public.payments where order_id = new.order_id and voided_at is null;
  if already + new.amount > tot then raise exception 'Montant supérieur au reste dû (% F)', greatest(tot - already, 0); end if;
  new.created_at := least(coalesce(new.created_at, now()), now());
  if new.created_at < now() - interval '60 days' then new.created_at := now(); end if;
  new.voided_at := null; new.voided_by := null; new.void_reason := '';
  update public.pressings set next_payment = next_payment + 1 where id = new.pressing_id returning next_payment - 1 into new.number;
  return new;
end $$;
drop trigger if exists payments_before on public.payments;
create trigger payments_before before insert on public.payments for each row execute function public.payments_before_insert();

create or replace function public.sync_paid()
returns trigger language plpgsql security definer set search_path = '' as $$
declare oid uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders o set paid = coalesce((select sum(amount) from public.payments p where p.order_id = oid and p.voided_at is null), 0) where o.id = oid;
  return null;
end $$;
drop trigger if exists payments_sync on public.payments;
create trigger payments_sync after insert or update or delete on public.payments for each row execute function public.sync_paid();

create or replace function public.void_payment(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare pid uuid;
begin
  select pressing_id into pid from public.payments where id = p_id;
  if pid is null then raise exception 'Paiement introuvable'; end if;
  if not public.is_owner(pid) then raise exception 'Seul le gérant peut annuler un paiement'; end if;
  if not public.can_write(pid) then raise exception 'Abonnement expiré ou accès refusé'; end if;
  update public.payments set voided_at = now(), voided_by = auth.uid(), void_reason = left(trim(coalesce(p_reason, '')), 200)
  where id = p_id and voided_at is null;
end $$;

/* ---------- 5. Tickets : annulation par le gérant seulement, paiements annulés avec ---------- */
alter table public.orders add column if not exists due int generated always as (total - paid) stored;

create or replace function public.orders_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'annule' and new.status <> 'annule' then raise exception 'Un ticket annulé ne peut pas être rouvert'; end if;
  if new.status = 'annule' and old.status <> 'annule' then
    if auth.uid() is not null and not public.is_owner(new.pressing_id) then raise exception 'Seul le gérant peut annuler un ticket'; end if;
    new.lot_id := null;
  end if;
  return new;
end $$;

create or replace function public.orders_after_cancel()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.payments set voided_at = now(), voided_by = auth.uid(), void_reason = 'Ticket annulé'
  where order_id = new.id and voided_at is null;
  return null;
end $$;

/* ---------- 6. Lots de lavage ---------- */
create table if not exists public.lots (
  id uuid primary key default gen_random_uuid(),
  pressing_id uuid not null references public.pressings(id) on delete cascade,
  number int not null,
  status text not null default 'recu' check (status in ('recu', 'lavage', 'pret')),
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pressing_id, number)
);
create index if not exists lots_pressing_created_idx on public.lots (pressing_id, created_at desc);
alter table public.lots enable row level security;
revoke all on public.lots from anon, authenticated;
grant select on public.lots to authenticated;
drop policy if exists lots_select on public.lots;
create policy lots_select on public.lots for select to authenticated using (public.is_member(pressing_id));

alter table public.orders add column if not exists lot_id uuid references public.lots(id) on delete set null;
create index if not exists orders_lot_idx on public.orders (lot_id);

drop trigger if exists orders_before on public.orders;
create trigger orders_before before update on public.orders for each row execute function public.orders_before_update();
drop trigger if exists orders_cancel on public.orders;
create trigger orders_cancel after update of status on public.orders for each row
  when (new.status = 'annule' and old.status is distinct from 'annule') execute function public.orders_after_cancel();

-- vérifie que les tickets peuvent entrer dans un lot (même pressing, reçus ou en lavage, sans lot)
create or replace function public.lot_check_orders(p_pressing uuid, p_orders uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if p_orders is null or cardinality(p_orders) = 0 then raise exception 'Choisis au moins un ticket'; end if;
  if cardinality(p_orders) > 300 then raise exception 'Trop de tickets dans un seul lot'; end if;
  if (select count(*) from public.orders where id = any(p_orders) and pressing_id = p_pressing) <> cardinality(array(select distinct unnest(p_orders))) then
    raise exception 'Ticket introuvable (peut-être pas encore envoyé au serveur)';
  end if;
  for r in select o.number, o.status, l.number lot from public.orders o left join public.lots l on l.id = o.lot_id where o.id = any(p_orders) loop
    if r.lot is not null then raise exception 'Le ticket #% est déjà dans le lot %', lpad(r.number::text, 4, '0'), lpad(r.lot::text, 3, '0'); end if;
    if r.status not in ('recu', 'lavage') then raise exception 'Le ticket #% n''est plus à laver', lpad(r.number::text, 4, '0'); end if;
  end loop;
end $$;

create or replace function public.create_lot(p_pressing uuid, p_orders uuid[], p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare lid uuid; num int;
begin
  if not public.is_owner(p_pressing) then raise exception 'Seul le gérant peut créer un lot'; end if;
  if not public.can_write(p_pressing) then raise exception 'Abonnement expiré ou accès refusé'; end if;
  perform public.lot_check_orders(p_pressing, p_orders);
  update public.pressings set next_lot = next_lot + 1 where id = p_pressing returning next_lot - 1 into num;
  -- le lot démarre « en lavage » seulement si tous ses tickets y sont déjà
  insert into public.lots(pressing_id, number, status, note, created_by)
  values (p_pressing, num,
          case when exists(select 1 from public.orders where id = any(p_orders) and status = 'recu') then 'recu' else 'lavage' end,
          left(trim(coalesce(p_note, '')), 200), auth.uid())
  returning id into lid;
  update public.orders set lot_id = lid where id = any(p_orders);
  return jsonb_build_object('id', lid, 'number', num);
end $$;

create or replace function public.lot_add_orders(p_lot uuid, p_orders uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  select * into l from public.lots where id = p_lot;
  if l.id is null then raise exception 'Lot introuvable'; end if;
  if not public.is_owner(l.pressing_id) then raise exception 'Seul le gérant peut modifier un lot'; end if;
  if not public.can_write(l.pressing_id) then raise exception 'Abonnement expiré ou accès refusé'; end if;
  if l.status = 'pret' then raise exception 'Ce lot est déjà prêt : crée un nouveau lot'; end if;
  perform public.lot_check_orders(l.pressing_id, p_orders);
  -- un ticket reçu ajouté à un lot déjà en lavage passe en lavage avec lui
  update public.orders set lot_id = p_lot, status = case when l.status = 'lavage' then 'lavage' else status end where id = any(p_orders);
end $$;

create or replace function public.lot_remove_order(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare pid uuid;
begin
  select pressing_id into pid from public.orders where id = p_order;
  if pid is null or not public.is_owner(pid) then raise exception 'Seul le gérant peut modifier un lot'; end if;
  if not public.can_write(pid) then raise exception 'Abonnement expiré ou accès refusé'; end if;
  update public.orders set lot_id = null where id = p_order;
end $$;

create or replace function public.lot_set_status(p_lot uuid, p_status text)
returns int language plpgsql security definer set search_path = '' as $$
declare l record; n int;
begin
  select * into l from public.lots where id = p_lot;
  if l.id is null then raise exception 'Lot introuvable'; end if;
  if not public.can_write(l.pressing_id) then raise exception 'Abonnement expiré ou accès refusé'; end if;
  if p_status not in ('recu', 'lavage', 'pret') then raise exception 'Étape invalide'; end if;
  update public.lots set status = p_status, updated_at = now() where id = p_lot;
  update public.orders set status = p_status,
      ready_at = case when p_status = 'pret' then coalesce(case when status = 'pret' then ready_at end, now()) else null end,
      picked_at = null
    where lot_id = p_lot and status in ('recu', 'lavage', 'pret');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.delete_lot(p_lot uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare pid uuid;
begin
  select pressing_id into pid from public.lots where id = p_lot;
  if pid is null or not public.is_owner(pid) then raise exception 'Seul le gérant peut supprimer un lot'; end if;
  delete from public.lots where id = p_lot;
end $$;

-- recherche dans tous les tickets (pas seulement ceux chargés sur le téléphone)
create or replace function public.search_orders(p_pressing uuid, p_term text)
returns setof uuid language sql stable security invoker set search_path = '' as $$
  with t as (select trim(coalesce(p_term, '')) term, regexp_replace(coalesce(p_term, ''), '\D', '', 'g') dg)
  select o.id from public.orders o left join public.customers c on c.id = o.customer_id, t
  where o.pressing_id = p_pressing and char_length(t.term) >= 2 and (
       (t.dg <> '' and o.number::text = coalesce(nullif(ltrim(t.dg, '0'), ''), '0'))
    or (char_length(t.dg) >= 3 and c.phone like '%' || t.dg || '%')
    or c.name ilike '%' || replace(replace(t.term, '%', ''), '_', '') || '%')
  order by o.created_at desc limit 60;
$$;

/* ---------- 7. Création de ticket : numéro du paiement d'avance, catalogue réservé au gérant ---------- */
create or replace function public.create_order(p_pressing uuid, p_customer jsonb, p_items jsonb, p_opts jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  st jsonb; cid uuid; cname text; cphone text; num int; oid uuid; nxt int; ts timestamptz; code text;
  sub int := 0; extra int := 0; dfee int := 0; disc int := 0; tot int; adv int; pnum int;
  it jsonb; every int; pct int; prev int; existing jsonb;
begin
  if not public.can_write(p_pressing) then raise exception 'Abonnement expiré ou accès refusé'; end if;

  if nullif(p_opts->>'id','') is not null then
    select jsonb_build_object('id', o.id, 'number', o.number, 'total', o.total, 'discount', o.discount, 'track_code', o.track_code, 'customer_id', o.customer_id,
             'payment_number', (select p.number from public.payments p where p.order_id = o.id order by p.created_at limit 1), 'replayed', true)
      into existing from public.orders o where o.id = (p_opts->>'id')::uuid and o.pressing_id = p_pressing;
    if existing is not null then return existing; end if;
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Ajoute au moins un article'; end if;
  if jsonb_array_length(p_items) > 100 then raise exception 'Trop d''articles'; end if;
  select settings, next_ticket into st, nxt from public.pressings where id = p_pressing;

  ts := least(coalesce(nullif(p_opts->>'created_at','')::timestamptz, now()), now());
  if ts < now() - interval '60 days' then ts := now(); end if;

  cphone := regexp_replace(coalesce(p_customer->>'phone',''), '\D', '', 'g');
  cname := trim(coalesce(p_customer->>'name',''));
  if nullif(p_customer->>'id','') is not null then
    select id into cid from public.customers where id = (p_customer->>'id')::uuid and pressing_id = p_pressing;
  end if;
  if cid is null and cphone <> '' then
    select id into cid from public.customers where pressing_id = p_pressing and phone = cphone;
  end if;
  if cid is null then
    if cname = '' then raise exception 'Nom du client requis'; end if;
    if nullif(p_customer->>'id','') is not null and not exists(select 1 from public.customers where id = (p_customer->>'id')::uuid) then
      insert into public.customers(id, pressing_id, name, phone, created_at) values ((p_customer->>'id')::uuid, p_pressing, left(cname,80), cphone, ts) returning id into cid;
    else
      insert into public.customers(pressing_id, name, phone, created_at) values (p_pressing, left(cname,80), cphone, ts) returning id into cid;
    end if;
  end if;

  if nullif(p_opts->>'number','') is not null then
    num := (p_opts->>'number')::int;
    if num < 1 or num >= nxt then raise exception 'Numéro de ticket non réservé'; end if;
    if exists(select 1 from public.orders where pressing_id = p_pressing and number = num) then
      update public.pressings set next_ticket = next_ticket + 1 where id = p_pressing returning next_ticket - 1 into num;
    end if;
  else
    update public.pressings set next_ticket = next_ticket + 1 where id = p_pressing returning next_ticket - 1 into num;
  end if;

  code := upper(coalesce(p_opts->>'track_code',''));
  if code !~ '^[A-Z0-9]{8}$' or exists(select 1 from public.orders where track_code = code) then code := public.gen_track_code(); end if;

  for it in select * from jsonb_array_elements(p_items) loop
    if char_length(trim(coalesce(it->>'name',''))) = 0 then raise exception 'Article sans nom'; end if;
    if coalesce((it->>'qty')::int,0) not between 1 and 999 then raise exception 'Quantité invalide'; end if;
    if coalesce((it->>'unit_price')::int,-1) not between 0 and 10000000 then raise exception 'Prix invalide'; end if;
    sub := sub + (it->>'qty')::int * (it->>'unit_price')::int;
  end loop;

  if coalesce((p_opts->>'express')::boolean,false) then extra := round(sub * coalesce((st->>'express_pct')::int,50) / 100.0); end if;
  -- frais de livraison : ceux réglés par le gérant
  if coalesce((p_opts->>'delivery')::boolean,false) then dfee := greatest(0, coalesce((st->>'delivery_fee')::int, 0)); end if;
  every := coalesce((st->>'loyalty_every')::int,0);
  pct := coalesce((st->>'loyalty_pct')::int,0);
  if every > 0 and pct > 0 then
    select count(*) into prev from public.orders where customer_id = cid and status <> 'annule';
    if (prev + 1) % every = 0 then disc := round(sub * pct / 100.0); end if;
  end if;
  tot := sub + extra + dfee - disc;

  insert into public.orders(id, pressing_id, number, customer_id, express, delivery, delivery_fee, subtotal, discount, total, due_at, notes, created_by, created_at, track_code)
  values (coalesce(nullif(p_opts->>'id','')::uuid, gen_random_uuid()), p_pressing, num, cid,
          coalesce((p_opts->>'express')::boolean,false), coalesce((p_opts->>'delivery')::boolean,false), dfee,
          sub, disc, tot, nullif(p_opts->>'due_at','')::date, left(coalesce(p_opts->>'notes',''),500), auth.uid(), ts, code)
  returning id into oid;

  insert into public.order_items(order_id, pressing_id, name, qty, unit_price, color, defects)
  select oid, p_pressing, left(trim(x->>'name'),60), (x->>'qty')::int, (x->>'unit_price')::int,
         left(coalesce(x->>'color',''),40), left(coalesce(x->>'defects',''),200)
  from jsonb_array_elements(p_items) x;

  if coalesce((p_opts->>'save_new_types')::boolean,false) and public.is_owner(p_pressing) then
    insert into public.garment_types(pressing_id, name, category, price)
    select distinct on (lower(trim(x->>'name'))) p_pressing, left(trim(x->>'name'),60), 'Autre', (x->>'unit_price')::int
    from jsonb_array_elements(p_items) x
    where not exists(select 1 from public.garment_types g where g.pressing_id = p_pressing and lower(g.name) = lower(trim(x->>'name')))
    on conflict do nothing;
  end if;

  adv := least(coalesce((p_opts->>'advance')::int,0), tot);
  if adv > 0 then
    insert into public.payments(id, order_id, pressing_id, amount, method, created_by, created_at)
    values (coalesce(nullif(p_opts->>'payment_id','')::uuid, gen_random_uuid()), oid, p_pressing, adv, coalesce(nullif(p_opts->>'method',''),'especes'), auth.uid(), ts)
    returning number into pnum;
  end if;

  return jsonb_build_object('id', oid, 'number', num, 'total', tot, 'discount', disc, 'track_code', code, 'customer_id', cid, 'payment_number', pnum);
end $function$;

/* ---------- 8. Admin : encaissé sans les paiements annulés ---------- */
create or replace function public.admin_overview()
returns table(id uuid, name text, phone text, address text, status text, paid_until timestamptz, created_at timestamptz, owner_email text, members integer, customers integer, orders integer, orders_30d integer, revenue_30d bigint, last_activity timestamptz)
language plpgsql stable security definer set search_path = '' as $function$
begin
  if not public.is_platform_admin() then raise exception 'Accès refusé'; end if;
  return query
  select p.id, p.name, p.phone, p.address, p.status, p.paid_until, p.created_at,
    (select u.email::text from auth.users u where u.id = p.owner_id),
    (select count(*)::int from public.members m where m.pressing_id = p.id),
    (select count(*)::int from public.customers c where c.pressing_id = p.id),
    (select count(*)::int from public.orders o where o.pressing_id = p.id),
    (select count(*)::int from public.orders o where o.pressing_id = p.id and o.created_at > now() - interval '30 days'),
    (select coalesce(sum(pa.amount),0)::bigint from public.payments pa where pa.pressing_id = p.id and pa.voided_at is null and pa.created_at > now() - interval '30 days'),
    (select max(o.created_at) from public.orders o where o.pressing_id = p.id)
  from public.pressings p order by p.created_at desc;
end $function$;

/* ---------- 9. Fonctions : personne d'autre que les comptes connectés ---------- */
revoke execute on function public.gen_join_code(), public.members_after_delete(), public.payments_before_insert(),
  public.orders_before_update(), public.orders_after_cancel(), public.lot_check_orders(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.regen_join_code(uuid), public.void_payment(uuid, text), public.create_lot(uuid, uuid[], text),
  public.lot_add_orders(uuid, uuid[]), public.lot_remove_order(uuid), public.lot_set_status(uuid, text), public.delete_lot(uuid),
  public.search_orders(uuid, text) from public, anon;
grant execute on function public.regen_join_code(uuid), public.void_payment(uuid, text), public.create_lot(uuid, uuid[], text),
  public.lot_add_orders(uuid, uuid[]), public.lot_remove_order(uuid), public.lot_set_status(uuid, text), public.delete_lot(uuid),
  public.search_orders(uuid, text) to authenticated;
