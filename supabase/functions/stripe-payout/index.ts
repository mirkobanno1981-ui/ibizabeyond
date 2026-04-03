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
    const { quoteId, targetType, amount } = await req.json();

    if (!quoteId || !targetType) {
      throw new Error('Missing parameters: quoteId and targetType are required.');
    }

    // 1. Fetch Quote and Account details
    const { data: quote, error: quoteErr } = await supabase
      .from('quotes')
      .select(`
        *,
        invenio_properties (
          owners (stripe_account_id)
        ),
        agents (stripe_account_id)
      `)
      .eq('id', quoteId)
      .single();

    if (quoteErr || !quote) throw new Error('Quote not found.');

    let destinationAccount = null;
    let description = '';

    if (targetType === 'owner') {
      destinationAccount = quote.invenio_properties?.owners?.stripe_account_id;
      description = `Payout to Owner for Quote ${quoteId}`;
    } else if (targetType === 'collaborator') {
      destinationAccount = quote.agents?.stripe_account_id;
      description = `Commission to Collaborator for Quote ${quoteId}`;
    }

    if (!destinationAccount) {
      throw new Error(`The ${targetType} does not have a linked Stripe Account.`);
    }

    // 2. Perform Transfer
    // NOTE: In production you should verify if this was already paid!
    const transfer = await stripe.transfers.create({
      amount: Math.round(amount * 100), // in cents
      currency: quote.currency || 'eur',
      destination: destinationAccount,
      description: description,
      metadata: {
        quoteId: quoteId,
        targetType: targetType
      }
    });

    // 3. Update DB to track this split (e.g. metadata or a payout table)
    // For now we'll just log success
    console.log(`Success: Transfer ${transfer.id} to ${destinationAccount}`);

    return new Response(JSON.stringify({ success: true, transferId: transfer.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('PAYOUT ERROR:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
