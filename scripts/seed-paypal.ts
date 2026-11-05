import { runScript } from './runtime';

runScript(async () => {
  const { paypalCredentials } = await import('../lib/paypal/rest');
  paypalCredentials();
  const { supabaseAdmin } = await import('../lib/supabase/server');
  const { createCycleInvoices } = await import('../lib/chama/server/money');
  const { checked } = await import('../lib/chama/server/store');
  const { getChamaSnapshot } = await import('../lib/chama/snapshot');
  const snapshot = await getChamaSnapshot('umoja-sisters');
  const email = process.env.PAYPAL_SANDBOX_PERSONAL_EMAIL?.trim();
  if (email) {
    const { z } = await import('zod');
    z.email().parse(email);
    checked(await supabaseAdmin().from('chama_members').update({ email }).eq('group_id', snapshot.group.id).eq('handle', 'wanjiru'));
    console.info('Sandbox stand-in email configured for Wanjiru.');
  }
  const result = await createCycleInvoices('umoja-sisters');
  console.table([...result.created, ...result.skipped]);
});
