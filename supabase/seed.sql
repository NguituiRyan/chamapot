-- Demo chama for ChamaPot: Umoja Sisters. Re-runnable: deletes and recreates the umoja-sisters group.
-- History (cycles 1-6) is seeded demo data, flagged is_seed = true. The current cycle's outstanding
-- contributions get REAL PayPal sandbox invoices from `npm run seed:paypal`.
do $$
declare
  g uuid;
  m record;
  c record;
  members text[][] := array[
    -- handle, full_name, city, country, role, pays_via, phone, colour
    array['grace','Grace Wanjiku','Nairobi','Kenya','chair','cash','+254 712 401 118','#0E7C66'],
    array['halima','Halima Abdi','Nairobi','Kenya','member','cash','+254 722 930 245','#B45309'],
    array['atieno','Atieno Ochieng','London','United Kingdom','member','paypal','+44 7700 900 412','#7C3AED'],
    array['njoki','Njoki Mwangi','Nairobi','Kenya','member','cash','+254 733 118 902','#DB2777'],
    array['chebet','Chebet Kiprono','Dubai','United Arab Emirates','member','paypal','+971 50 123 4471','#0369A1'],
    array['akinyi','Akinyi Odhiambo','Nairobi','Kenya','treasurer','cash','+254 701 556 730','#15803D'],
    array['wanjiru','Wanjiru Kamau','Dallas','United States','member','paypal','+1 214 555 0187','#C2410C'],
    array['nyokabi','Nyokabi Githinji','Minneapolis','United States','member','paypal','+1 612 555 0143','#4338CA'],
    array['mumbi','Mumbi Njeri','Nairobi','Kenya','secretary','cash','+254 790 221 604','#A21CAF'],
    array['wairimu','Wairimu Kariuki','Manchester','United Kingdom','member','paypal','+44 7700 900 731','#0F766E']
  ];
  months date[] := array['2026-05-01','2026-06-01','2026-07-01','2026-08-01','2026-09-01','2026-10-01','2026-11-01','2026-12-01','2027-01-01','2027-02-01']::date[];
  payout_days date[] := array['2026-05-30','2026-06-27','2026-07-25','2026-08-29','2026-09-26','2026-10-31','2026-11-28','2026-12-26','2027-01-30','2027-02-27']::date[];
  i int;
  rid uuid;
  cyc uuid;
  pay uuid;
  st text;
  outstanding text[] := array['atieno','halima','nyokabi'];
begin
  delete from public.chama_groups where slug = 'umoja-sisters';

  insert into public.chama_groups (slug, name, tagline, currency, contribution_amount, meeting_place, meeting_day,
                                   grace_days, late_fine, approvals_required, kes_per_usd)
  values ('umoja-sisters', 'Umoja Sisters Chama', 'Ten women, three continents, one pot.', 'USD', 50.00,
          'Kilimani, Nairobi (diaspora members join on video)', 'Last Saturday of the month', 7, 5.00, 2, 129.00)
  returning id into g;

  for i in 1..array_length(members, 1) loop
    insert into public.chama_members (group_id, handle, full_name, email, phone, city, country, role, pays_via,
                                      rotation_position, avatar_color, joined_on)
    values (g, members[i][1], members[i][2], members[i][1] || '@example.com', members[i][7], members[i][3],
            members[i][4], members[i][5], members[i][6], i, members[i][8], '2026-04-18');
  end loop;

  for i in 1..10 loop
    select id into rid from public.chama_members where group_id = g and rotation_position = i;
    st := case when i <= 6 then 'paid_out' when i = 7 then 'collecting' else 'upcoming' end;
    insert into public.chama_cycles (group_id, number, label, starts_on, due_on, payout_on, recipient_member_id,
                                     target_amount, status)
    values (g, i, to_char(months[i], 'FMMonth YYYY'), months[i], months[i] + 6, payout_days[i], rid, 500.00, st)
    returning id into cyc;

    if i <= 7 then
      for m in select * from public.chama_members where group_id = g order by rotation_position loop
        if i = 7 and m.handle = any(outstanding) then
          insert into public.chama_contributions (group_id, cycle_id, member_id, amount, status, method, is_seed)
          values (g, cyc, m.id, 50.00, case when m.pays_via = 'paypal' then 'invoiced' else 'pending' end, null, false);
        else
          insert into public.chama_contributions (group_id, cycle_id, member_id, amount, status, method, paid_at,
                                                  days_late, fine, fine_paid, is_seed)
          values (g, cyc, m.id, 50.00, 'paid',
                  case when m.pays_via = 'paypal' then 'paypal' else 'cash_recorded' end,
                  least((months[i] + ((m.rotation_position * 7 + i * 3) % 6) + 1)::timestamptz + interval '17 hours',
                        now() - interval '3 hours'),
                  case when (i = 3 and m.handle = 'nyokabi') or (i = 5 and m.handle = 'halima') then 4 else 0 end,
                  case when (i = 3 and m.handle = 'nyokabi') or (i = 5 and m.handle = 'halima') then 5.00 else 0 end,
                  (i = 3 and m.handle = 'nyokabi') or (i = 5 and m.handle = 'halima'),
                  true);
        end if;
      end loop;
    end if;

    if i <= 6 then
      insert into public.chama_payouts (group_id, cycle_id, recipient_member_id, amount, status, proposed_by, reason,
                                        sender_batch_id, paypal_status, is_seed, created_at, sent_at, completed_at)
      values (g, cyc, rid, 500.00, 'succeeded', 'treasurer', 'Cycle ' || i || ' pot, paid at the monthly meeting',
              'umoja-sisters-cycle-' || i, 'SUCCESS (seeded history)', true,
              payout_days[i]::timestamptz + interval '13 hours', payout_days[i]::timestamptz + interval '15 hours',
              payout_days[i]::timestamptz + interval '15 hours 2 minutes')
      returning id into pay;
      insert into public.chama_approvals (payout_id, member_id, decision, note, created_at)
      select pay, o.id, 'approve', 'Approved at the meeting', payout_days[i]::timestamptz + interval '14 hours'
      from public.chama_members o
      where o.group_id = g and o.role in ('chair','treasurer','secretary') and o.id <> rid
      order by case o.role when 'chair' then 1 when 'treasurer' then 2 else 3 end
      limit 2;
    end if;
  end loop;

  insert into public.chama_rules (group_id, key, label, value, source_quote, confidence, extracted_by) values
  (g, 'contribution_amount', 'Monthly contribution', '$50 per member per month',
   'Every member shall contribute fifty US dollars (USD 50) to the pot each month.', 0.98, 'seed'),
  (g, 'due_day', 'Due date', 'By the 7th of each month',
   'Contributions are due on or before the seventh (7th) day of every month.', 0.97, 'seed'),
  (g, 'late_fine', 'Late fine', '$5 if paid after the 7-day grace period',
   'A member who pays after the grace period of seven days shall pay a fine of five dollars (USD 5).', 0.95, 'seed'),
  (g, 'rotation', 'Rotation order', 'Fixed order agreed at founding (10 turns)',
   'The order of receiving the pot was agreed by ballot at the founding meeting and is recorded in the members register.', 0.9, 'seed'),
  (g, 'turn_swap', 'Swapping turns', 'Both members must agree and the chair must approve',
   'Two members may exchange turns only with the written consent of both and the approval of the Chairlady.', 0.88, 'seed'),
  (g, 'payout_approval', 'Payout approval', 'Two officials must approve; the recipient cannot approve her own pot',
   'No money shall leave the pot without the approval of two officials. An official receiving the pot may not approve her own payout.', 0.96, 'seed'),
  (g, 'payout_day', 'Payout day', 'Last Saturday of the month, at the meeting',
   'The pot shall be handed over at the monthly meeting held on the last Saturday of the month.', 0.93, 'seed'),
  (g, 'default', 'Missed contributions', 'Two missed months in a row: turn suspended until cleared',
   'A member who fails to contribute for two consecutive months shall have her turn suspended until all arrears are cleared.', 0.86, 'seed');

  insert into public.chama_events (group_id, kind, actor, summary, created_at) values
  (g, 'payout', 'treasurer', 'October pot of $500 paid out to Akinyi Odhiambo (cycle 6)', '2026-10-31 15:02:00+03'),
  (g, 'cycle', 'treasurer-agent', 'November cycle opened: $50 contributions invoiced to diaspora members, due 7 Nov', '2026-11-01 09:00:00+03'),
  (g, 'contribution', 'paypal-webhook', 'Diaspora contributions for November arriving via PayPal', '2026-11-02 18:41:00+03'),
  (g, 'contribution', 'treasurer', 'Cash contributions from the Nairobi members recorded by the treasurer', '2026-11-03 11:15:00+03');
end $$;
