import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';

const supa = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function go() {
  // Login as info@ibizabeyond.com (we don't have the password but what if we do?)
  // Actually we CAN sign in with service_role and create a jwt or something?
  // We don't have the password, we can't test RLS accurately because we don't know it.
}
