-- Baseline-based cold storage inventory for Roselor.
-- Opening quantities are the physical counts confirmed by the greenhouse manager on 2026-11-10.

create table if not exists public.cold_storage_opening_balances (
  greenhouse text primary key check (greenhouse in ('azna','khorramabad')),
  opening_bundles integer not null check (opening_bundles >= 0),
  baseline_at timestamptz not null,
  baseline_date date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cold_storage_movements (
  id bigint generated always as identity primary key,
  greenhouse text not null check (greenhouse in ('azna','khorramabad')),
  source_type text not null check (source_type in ('shipment','daily_harvest')),
  source_id text not null,
  delta_bundles integer not null,
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create index if not exists cold_storage_movements_greenhouse_idx
  on public.cold_storage_movements (greenhouse, created_at);

alter table public.cold_storage_opening_balances enable row level security;
alter table public.cold_storage_movements enable row level security;
revoke all on public.cold_storage_opening_balances from anon, authenticated;
revoke all on public.cold_storage_movements from anon, authenticated;
grant all on public.cold_storage_opening_balances to service_role;
grant all on public.cold_storage_movements to service_role;
grant usage, select on sequence public.cold_storage_movements_id_seq to service_role;

create or replace function public.track_cold_storage_movement()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_baseline_at timestamptz;
  v_baseline_date date;
  v_existing public.cold_storage_movements%rowtype;
  v_delta integer;
begin
  if tg_table_name = 'shipments' then
    if tg_op = 'INSERT' then
      select baseline_at into v_baseline_at
      from public.cold_storage_opening_balances where greenhouse=new.greenhouse;
      if not found or new.created_at < v_baseline_at then return new; end if;
      v_delta := case when new.status not in ('cancelled','rejected') then -coalesce(new.quantity_bundles,0) else 0 end;
      if v_delta <> 0 then
        insert into public.cold_storage_movements(greenhouse,source_type,source_id,delta_bundles)
        values (new.greenhouse,'shipment',new.id,v_delta)
        on conflict (source_type,source_id) do update
          set greenhouse=excluded.greenhouse, delta_bundles=excluded.delta_bundles;
      end if;
      return new;
    elsif tg_op = 'UPDATE' then
      select * into v_existing from public.cold_storage_movements
      where source_type='shipment' and source_id=old.id;
      if found then
        v_delta := case when new.status not in ('cancelled','rejected') then -coalesce(new.quantity_bundles,0) else 0 end;
        update public.cold_storage_movements set greenhouse=new.greenhouse,delta_bundles=v_delta
        where id=v_existing.id;
      else
        select baseline_at into v_baseline_at from public.cold_storage_opening_balances where greenhouse=new.greenhouse;
        if found and new.created_at >= v_baseline_at then
          v_delta := case when new.status not in ('cancelled','rejected') then -coalesce(new.quantity_bundles,0) else 0 end;
          if v_delta <> 0 then
            insert into public.cold_storage_movements(greenhouse,source_type,source_id,delta_bundles)
            values(new.greenhouse,'shipment',new.id,v_delta)
            on conflict (source_type,source_id) do nothing;
          end if;
        end if;
      end if;
      return new;
    elsif tg_op = 'DELETE' then
      update public.cold_storage_movements set delta_bundles=0
      where source_type='shipment' and source_id=old.id;
      return old;
    end if;
  elsif tg_table_name = 'daily_harvest' then
    if tg_op = 'INSERT' then
      select baseline_date,baseline_at into v_baseline_date,v_baseline_at
      from public.cold_storage_opening_balances where greenhouse=new.greenhouse;
      if not found or new.harvest_date < v_baseline_date or new.created_at < v_baseline_at then return new; end if;
      if coalesce(new.quantity_bundles,0) <> 0 then
        insert into public.cold_storage_movements(greenhouse,source_type,source_id,delta_bundles)
        values(new.greenhouse,'daily_harvest',new.id::text,coalesce(new.quantity_bundles,0))
        on conflict (source_type,source_id) do update
          set greenhouse=excluded.greenhouse,delta_bundles=excluded.delta_bundles;
      end if;
      return new;
    elsif tg_op = 'UPDATE' then
      select * into v_existing from public.cold_storage_movements
      where source_type='daily_harvest' and source_id=old.id::text;
      if found then
        update public.cold_storage_movements
        set delta_bundles=coalesce(v_existing.delta_bundles,0)
          + coalesce(new.quantity_bundles,0)-coalesce(old.quantity_bundles,0)
        where id=v_existing.id;
      else
        select baseline_date into v_baseline_date from public.cold_storage_opening_balances where greenhouse=new.greenhouse;
        if found and new.harvest_date >= v_baseline_date then
          v_delta := coalesce(new.quantity_bundles,0)-coalesce(old.quantity_bundles,0);
          if v_delta <> 0 then
            insert into public.cold_storage_movements(greenhouse,source_type,source_id,delta_bundles)
            values(new.greenhouse,'daily_harvest',new.id::text,v_delta)
            on conflict (source_type,source_id) do nothing;
          end if;
        end if;
      end if;
      return new;
    elsif tg_op = 'DELETE' then
      update public.cold_storage_movements set delta_bundles=0
      where source_type='daily_harvest' and source_id=old.id::text;
      return old;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists shipments_cold_storage_movement on public.shipments;
create trigger shipments_cold_storage_movement
after insert or update or delete on public.shipments
for each row execute function public.track_cold_storage_movement();

drop trigger if exists daily_harvest_cold_storage_movement on public.daily_harvest;
create trigger daily_harvest_cold_storage_movement
after insert or update or delete on public.daily_harvest
for each row execute function public.track_cold_storage_movement();

-- Preserve the first confirmed baseline if this migration is re-applied.
insert into public.cold_storage_opening_balances(greenhouse,opening_bundles,baseline_at,baseline_date,notes)
values
 ('khorramabad',101,'2026-11-10 13:16:46.087441+00','2026-11-10','موجودی فیزیکی اعلام‌شده توسط مدیر؛ موجودی مبنا'),
 ('azna',134,'2026-11-10 13:16:46.087441+00','2026-11-10','موجودی فیزیکی اعلام‌شده توسط مدیر؛ موجودی مبنا')
on conflict (greenhouse) do nothing;
