-- Enforce the manager's explicit rule: opening physical stock is the balance for
-- the baseline day itself. Only harvests and shipments dated after that day
-- affect the ledger (Iran local calendar date).

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
      select baseline_at,baseline_date into v_baseline_at,v_baseline_date
      from public.cold_storage_opening_balances where greenhouse=new.greenhouse;
      if not found or (new.created_at at time zone 'Asia/Tehran')::date <= v_baseline_date then return new; end if;
      v_delta := case when new.status not in ('cancelled','rejected') then -coalesce(new.quantity_bundles,0) else 0 end;
      if v_delta <> 0 then
        insert into public.cold_storage_movements(greenhouse,source_type,source_id,delta_bundles)
        values (new.greenhouse,'shipment',new.id,v_delta)
        on conflict (source_type,source_id) do update
          set greenhouse=excluded.greenhouse,delta_bundles=excluded.delta_bundles;
      end if;
      return new;
    elsif tg_op = 'UPDATE' then
      select * into v_existing from public.cold_storage_movements where source_type='shipment' and source_id=old.id;
      if found then
        v_delta := case when new.status not in ('cancelled','rejected') then -coalesce(new.quantity_bundles,0) else 0 end;
        update public.cold_storage_movements set greenhouse=new.greenhouse,delta_bundles=v_delta where id=v_existing.id;
      else
        select baseline_date into v_baseline_date from public.cold_storage_opening_balances where greenhouse=new.greenhouse;
        if found and (new.created_at at time zone 'Asia/Tehran')::date > v_baseline_date then
          v_delta := case when new.status not in ('cancelled','rejected') then -coalesce(new.quantity_bundles,0) else 0 end;
          if v_delta <> 0 then
            insert into public.cold_storage_movements(greenhouse,source_type,source_id,delta_bundles)
            values(new.greenhouse,'shipment',new.id,v_delta) on conflict(source_type,source_id) do nothing;
          end if;
        end if;
      end if;
      return new;
    elsif tg_op = 'DELETE' then
      update public.cold_storage_movements set delta_bundles=0 where source_type='shipment' and source_id=old.id;
      return old;
    end if;
  elsif tg_table_name = 'daily_harvest' then
    if tg_op = 'INSERT' then
      select baseline_date,baseline_at into v_baseline_date,v_baseline_at
      from public.cold_storage_opening_balances where greenhouse=new.greenhouse;
      if not found or new.harvest_date <= v_baseline_date then return new; end if;
      if coalesce(new.quantity_bundles,0) <> 0 then
        insert into public.cold_storage_movements(greenhouse,source_type,source_id,delta_bundles)
        values(new.greenhouse,'daily_harvest',new.id::text,new.quantity_bundles)
        on conflict(source_type,source_id) do update
          set greenhouse=excluded.greenhouse,delta_bundles=excluded.delta_bundles;
      end if;
      return new;
    elsif tg_op = 'UPDATE' then
      select * into v_existing from public.cold_storage_movements where source_type='daily_harvest' and source_id=old.id::text;
      if found then
        update public.cold_storage_movements
        set delta_bundles=coalesce(v_existing.delta_bundles,0)+coalesce(new.quantity_bundles,0)-coalesce(old.quantity_bundles,0)
        where id=v_existing.id;
      else
        select baseline_date into v_baseline_date from public.cold_storage_opening_balances where greenhouse=new.greenhouse;
        if found and new.harvest_date > v_baseline_date then
          v_delta := coalesce(new.quantity_bundles,0)-coalesce(old.quantity_bundles,0);
          if v_delta <> 0 then
            insert into public.cold_storage_movements(greenhouse,source_type,source_id,delta_bundles)
            values(new.greenhouse,'daily_harvest',new.id::text,v_delta) on conflict(source_type,source_id) do nothing;
          end if;
        end if;
      end if;
      return new;
    elsif tg_op = 'DELETE' then
      update public.cold_storage_movements set delta_bundles=0 where source_type='daily_harvest' and source_id=old.id::text;
      return old;
    end if;
  end if;
  return null;
end;
$$;