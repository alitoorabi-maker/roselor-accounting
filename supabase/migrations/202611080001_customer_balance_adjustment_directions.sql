-- Add explicit customer account adjustment directions.
-- increase_debt -> debit_adjustment (debit)
-- decrease_debt -> credit_adjustment (credit)
-- Existing adjustment rows and opening balances are left unchanged.

CREATE OR REPLACE FUNCTION public.rebuild_customer_account(p_customer_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  v_balance numeric;
  v_azna numeric:=0;
  v_kh numeric:=0;
  v_greenhouse text;
begin
  delete from public.customer_account_ledger where customer_id=p_customer_id;
  for v_greenhouse in select unnest(array['azna','khorramabad'])
  loop
    v_balance:=coalesce((
      select ob.amount_rial
      from public.customer_opening_balances ob
      where ob.customer_id=p_customer_id and ob.greenhouse=v_greenhouse
      order by ob.as_of_date desc,ob.id desc limit 1
    ),0);
    if exists(
      select 1 from public.customer_opening_balances ob
      where ob.customer_id=p_customer_id and ob.greenhouse=v_greenhouse
    ) then
      insert into public.customer_account_ledger(
        customer_id,greenhouse,event_at,source_type,source_id,description,
        debit_rial,credit_rial,balance_after_rial
      )
      select p_customer_id,v_greenhouse,ob.as_of_date,'opening_balance',ob.id,
        'مانده افتتاحیه',ob.amount_rial,0,ob.amount_rial
      from public.customer_opening_balances ob
      where ob.customer_id=p_customer_id and ob.greenhouse=v_greenhouse
      order by ob.as_of_date desc,ob.id desc limit 1;
    end if;

    for r in
      select event_at,source_type,source_id,description,debit_rial,credit_rial
      from (
        select i.invoice_date event_at,'invoice'::text source_type,i.id source_id,
          'فاکتور'::text description,i.net_sales_rial debit_rial,0::numeric credit_rial
        from public.invoices i
        join public.shipments s on s.id=i.shipment_id
        where s.customer_id=p_customer_id and s.greenhouse=v_greenhouse
          and coalesce(lower(i.status),'') not in ('cancelled','canceled','باطل','لغو')
          and not (
            coalesce(lower(i.status),'')='pending'
            and coalesce(i.notes,'') like 'supervisor_submission:%'
          )
          and i.invoice_date>=coalesce((
            select ob.as_of_date from public.customer_opening_balances ob
            where ob.customer_id=p_customer_id and ob.greenhouse=v_greenhouse
            order by ob.as_of_date desc,ob.id desc limit 1
          ),'-infinity'::timestamptz)

        union all

        select p.payment_date,'payment'::text,p.id,'دریافت مشتری'::text,
          0::numeric,p.amount_rial
        from public.payments p
        left join public.bank_accounts ba on ba.id=p.bank_account_id
        left join public.bank_transactions bt on bt.id=p.bank_transaction_id
        where p.customer_id=p_customer_id
          and coalesce(
            case when bt.accounting_scope in ('azna','khorramabad')
              then bt.accounting_scope else null end,
            ba.greenhouse,
            (
              select s2.greenhouse
              from public.invoices i2
              join public.shipments s2 on s2.id=i2.shipment_id
              where i2.id=p.invoice_id
            )
          )=v_greenhouse
          and p.payment_date>=coalesce((
            select ob.as_of_date from public.customer_opening_balances ob
            where ob.customer_id=p_customer_id and ob.greenhouse=v_greenhouse
            order by ob.as_of_date desc,ob.id desc limit 1
          ),'-infinity'::timestamptz)

        union all

        select a.event_at,'adjustment'::text,a.id,a.description,
          case when a.adjustment_type in ('transfer_credit','credit_adjustment')
            then 0::numeric else a.amount_rial end,
          case when a.adjustment_type in ('transfer_credit','credit_adjustment')
            then a.amount_rial else 0::numeric end
        from public.customer_account_adjustments a
        where a.customer_id=p_customer_id and a.greenhouse=v_greenhouse
          and a.event_at>=coalesce((
            select ob.as_of_date from public.customer_opening_balances ob
            where ob.customer_id=p_customer_id and ob.greenhouse=v_greenhouse
            order by ob.as_of_date desc,ob.id desc limit 1
          ),'-infinity'::timestamptz)
      ) events
      order by event_at,
        case source_type when 'invoice' then 1 when 'adjustment' then 2 else 3 end,
        source_id
    loop
      v_balance:=v_balance+r.debit_rial-r.credit_rial;
      insert into public.customer_account_ledger(
        customer_id,greenhouse,event_at,source_type,source_id,description,
        debit_rial,credit_rial,balance_after_rial
      )
      values(
        p_customer_id,v_greenhouse,r.event_at,r.source_type,r.source_id,
        r.description,r.debit_rial,r.credit_rial,v_balance
      );
    end loop;

    if v_greenhouse='azna' then v_azna:=v_balance; else v_kh:=v_balance; end if;
  end loop;

  insert into public.customer_balance_summary(
    customer_id,azna_balance_rial,khorramabad_balance_rial,total_balance_rial,updated_at
  )
  values(p_customer_id,v_azna,v_kh,v_azna+v_kh,now())
  on conflict(customer_id) do update
    set azna_balance_rial=excluded.azna_balance_rial,
        khorramabad_balance_rial=excluded.khorramabad_balance_rial,
        total_balance_rial=excluded.total_balance_rial,
        updated_at=now();
end;
$function$;
