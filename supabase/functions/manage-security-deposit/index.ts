import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.12.0?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')!;

  const stripe = new Stripe(stripeSecret, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { quoteId, action, amount } = await req.json(); // action: 'release' | 'capture'

    if (!quoteId || !action) {
      throw new Error('Missing quoteId or action');
    }

    // 1. Fetch quote and verify ownership
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        id,
        security_deposit_intent_id,
        invenio_properties (
          owner_id,
          deposit
        )
      `)
      .eq('id', quoteId)
      .single();

    if (quoteError || !quote) throw new Error('Quote not found');
    if (!quote.security_deposit_intent_id) throw new Error('No active security deposit found for this quote');

    // SECURITY CHECK: Verify if the user is the owner or super admin
    const authHeader = req.headers.get('Authorization')!;
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized');

    const isOwner = quote.invenio_properties?.owner_id === user.id;
    
    // Check role from user_roles table
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).single();
    const isSuperAdmin = roleData?.role === 'super_admin';

    if (!isOwner && !isSuperAdmin) {
      throw new Error('You do not have permission to manage this deposit');
    }

    let result;
    if (action === 'release') {
      // Void authorization
      result = await stripe.paymentIntents.cancel(quote.security_deposit_intent_id);
      
      // Update DB
      await supabase.from('quotes').update({ 
        security_deposit_authorized: false,
        payment_status: 'deposit_released' 
      }).eq('id', quoteId);

    } else if (action === 'capture') {
      // Capture funds (can be partial)
      const captureAmount = amount ? Math.round(amount * 100) : undefined; // amount in cents
      
      result = await stripe.paymentIntents.capture(quote.security_deposit_intent_id, {
        amount_to_capture: captureAmount
      });

      // Update DB
      await supabase.from('quotes').update({ 
        security_deposit_authorized: false,
        payment_status: 'deposit_captured'
      }).eq('id', quoteId);
    }

    return new Response(JSON.stringify({ success: true, result }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Manage Security Deposit Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
