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
    const { quoteId } = await req.json();

    if (!quoteId) {
      throw new Error('quoteId is required.');
    }

    // 1. Fetch Quote, Agent and Margin Settings
    const { data: quote, error: quoteErr } = await supabase
      .from('quotes')
      .select(`
        *,
        agents (
          id,
          company_name,
          stripe_account_id
        ),
        invenio_properties (villa_name)
      `)
      .eq('id', quoteId)
      .single();

    if (quoteErr || !quote) throw new Error('Quote not found.');
    
    const { data: marginSettings } = await supabase
      .from('margin_settings')
      .select('*')
      .limit(1)
      .single();
      
    const ivaPct = parseFloat(marginSettings?.iva_percent || '10');

    // 2. Fetch Agent Email from Auth
    const { data: { user }, error: userErr } = await supabase.auth.admin.getUserById(quote.agents.id);
    if (userErr || !user) throw new Error('Agent user not found.');

    const agentEmail = user.email;
    const companyName = quote.agents.company_name || 'Agent';

    // 3. Calculate Platform Fee + IVA
    const base = parseFloat(quote.supplier_base_price || '0');
    const adminPct = parseFloat(quote.admin_markup || '0');
    const platformNet = base * (adminPct / 100);
    const platformIva = platformNet * (ivaPct / 100);
    const totalAmountCents = Math.round((platformNet + platformIva) * 100);

    if (totalAmountCents <= 0) {
      return new Response(JSON.stringify({ success: true, message: 'Zero amount invoice skipped.' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 4. Find or Create Stripe Customer for the Agent
    let customer;
    const customers = await stripe.customers.list({ email: agentEmail, limit: 1 });
    if (customers.data.length > 0) {
      customer = customers.data[0];
    } else {
      customer = await stripe.customers.create({
        email: agentEmail,
        name: companyName,
        metadata: { agent_id: quote.agents.id }
      });
    }

    // 5. Create Invoice Item
    await stripe.invoiceItems.create({
      customer: customer.id,
      amount: totalAmountCents,
      currency: 'eur',
      description: `Platform Service Fee - Villa: ${quote.invenio_properties.villa_name} (Quote: ${quoteId.slice(0, 8)})`,
    });

    // 6. Create and Finalize Invoice
    const invoice = await stripe.invoices.create({
      customer: customer.id,
      auto_advance: true, // Automatically finalize and pay if possible, or send
      collection_method: 'send_invoice',
      days_until_due: 7,
      description: `Invenio Platform Service Fee for booking of ${quote.invenio_properties.villa_name}`,
      metadata: { quoteId: quoteId }
    });

    const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);

    return new Response(JSON.stringify({ success: true, invoiceId: finalizedInvoice.id, pdf: finalizedInvoice.invoice_pdf }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('INVOICE ERROR:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
