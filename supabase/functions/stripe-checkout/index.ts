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

  let body: any = {};
  try {
    body = await req.json();
  } catch (_e) {
    // Empty body
  }

  const { quoteId, type, method } = body;
  console.log('DEBUG: Received request:', { quoteId, type, method });

  if (!quoteId) {
    return new Response(JSON.stringify({ error: 'Missing quoteId' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. Fetch Quote & Related Data (incl. agent + owner stripe accounts)
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        id,
        final_price,
        supplier_base_price,
        admin_markup,
        agent_markup,
        editor_markup,
        editor_markup_mode,
        extra_services,
        agent_id,
        v_uuid,
        boat_uuid,
        check_in,
        check_out,
        rental_type,
        clients ( full_name, email ),
        properties (
          villa_name,
          deposit,
          editor_markup_percent,
          capturer_commission_mode,
          capturer_commission_pct,
          capturer_commission_amount,
          capturer_commission_included,
          rental_type_configs,
          owner_id,
          owners ( stripe_account_id, split_enabled, agent_id )
        ),
        boats (
          boat_name,
          security_deposit,
          owners ( stripe_account_id )
        ),
        agents!quotes_agent_id_fkey (
          id,
          agent_type,
          stripe_account_id,
          agency_split_pct
        )
      `)
      .eq('id', quoteId)
      .single();

    if (quoteError || !quote) {
      throw new Error(`Quote not found: ${quoteError?.message || 'Unknown error'}`);
    }

    const isVilla = !!quote.v_uuid;
    const displayName = isVilla
      ? (quote.properties?.villa_name || 'Villa Reservation')
      : (quote.boats?.boat_name || 'Boat Charter');

    const securityDepositAmount = isVilla
      ? parseFloat(quote.properties?.deposit || 0)
      : parseFloat(quote.boats?.security_deposit || 0);

    let ownerStripeAccount: string | null = isVilla
      ? (quote.properties?.owners?.stripe_account_id || null)
      : (quote.boats?.owners?.stripe_account_id || null);

    const ownerSplitEnabled = isVilla
      ? !!quote.properties?.owners?.split_enabled
      : false;

    // Capturer (editor) commission: per-quote override (% only) wins; otherwise
    // fall back to the villa-level capturer commission spec (mode + pct/amount +
    // included flag, with optional per-rental-type override of "included").
    const villaProps: any = quote.properties || {};
    const rentalTypeForSpec = (quote as any).rental_type || 'daily';
    const rtCfg = (villaProps.rental_type_configs?.[rentalTypeForSpec]) || {};
    const capMode: 'percent' | 'fixed' =
      (villaProps.capturer_commission_mode as any) || 'percent';
    const capPct = parseFloat(
      villaProps.capturer_commission_pct ?? villaProps.editor_markup_percent ?? 0
    ) || 0;
    const capAmount = parseFloat(villaProps.capturer_commission_amount ?? 0) || 0;
    const capIncluded =
      rtCfg.commission_included_override === true  ? true
    : rtCfg.commission_included_override === false ? false
    : !!villaProps.capturer_commission_included;

    // Quote-level override is always interpreted as percent (legacy behaviour).
    const quoteOverridePct = quote.editor_markup != null
      ? parseFloat(quote.editor_markup)
      : null;
    const editorMarkupPct = isVilla
      ? (quoteOverridePct != null ? quoteOverridePct : (capMode === 'percent' ? capPct : 0))
      : 0;

    const editorAgentId = isVilla
      ? quote.properties?.owners?.agent_id
      : null;

    // Fallback: villa.owner_id may point to an editor (agents row) without a matching
    // owners row. Treat the editor as the owner-side recipient (self-managed).
    let selfManagedEditor = false;
    if (isVilla && !ownerStripeAccount && quote.properties?.owner_id) {
      const { data: agt } = await supabase
        .from('agents')
        .select('id, company_name, stripe_account_id')
        .eq('id', quote.properties.owner_id)
        .single();
      if (agt?.stripe_account_id) {
        ownerStripeAccount = agt.stripe_account_id;
        selfManagedEditor = true;
      }
    }

    let editorStripeAccount: string | null = null;
    if (editorAgentId) {
      const { data: editorAgent } = await supabase
        .from('agents')
        .select('stripe_account_id')
        .eq('id', editorAgentId)
        .single();
      editorStripeAccount = editorAgent?.stripe_account_id || null;
    }

    const agentStripeAccount = quote.agents?.stripe_account_id;

    const origin = req.headers.get('origin') || 'https://ibizabeyond.com';
    let paymentMethodResolved = method || 'card';

    // ---- Amount & split calc ----
    const supplierBase = parseFloat(quote.supplier_base_price || 0);

    const checkInDate = new Date(quote.check_in);
    checkInDate.setUTCHours(0, 0, 0, 0);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const diffDays = Math.round((checkInDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const isLastMinute = diffDays <= 42; // 6 weeks

    let amountToCharge = 0;
    let applicationFeeAmount = 0;
    let supplierTransferAmount = 0;
    let useDirectCharge = false;

    if (type === 'security_deposit') {
      // Security deposit: stays on platform (manual capture)
      amountToCharge = securityDepositAmount;
      paymentMethodResolved = 'card';
    } else {
      // Booking deposit: 3-way split when agent has Connect account
      const supplierBase = parseFloat(quote.supplier_base_price || 0);
      const finalPrice = parseFloat(quote.final_price || 0);
      
      const upfrontStayPart = isLastMinute ? supplierBase : (supplierBase * 0.5);
      
      amountToCharge = (finalPrice - supplierBase) + upfrontStayPart;

      const extrasTotal = Array.isArray(quote.extra_services)
        ? quote.extra_services.reduce((s: number, x: any) => s + (parseFloat(x.price) || 0), 0)
        : 0;

      const ivaDivisor = 1.21; // 21% IVA
      const finalPriceNetOfIVA = finalPrice / ivaDivisor;
      const ivaAmount = finalPrice - finalPriceNetOfIVA;
      const totalProfit = Math.max(0, finalPriceNetOfIVA - supplierBase - extrasTotal);

      // Per-rental-type commission split (falls back to agent-level or 67/33 default)
      const rentalType = (quote as any).rental_type || 'daily';
      const rtConfig = isVilla
        ? ((quote.properties as any)?.rental_type_configs?.[rentalType] || null)
        : null;
      const agencySplitPct: number = rtConfig
        ? (100 - (rtConfig.platform_retention_pct || 33))
        : ((quote.agents as any)?.agency_split_pct || 67);

      const agencyProfit = totalProfit * (agencySplitPct / 100);
      const platformProfit = totalProfit * ((100 - agencySplitPct) / 100);

      let agentPortion = agencyProfit + extrasTotal;
      const platformPortion = platformProfit + upfrontStayPart + ivaAmount;

      // Flat 3% processing fee applied to all payment methods — shown as single price to client
      const processingFee = amountToCharge * 0.03;
      amountToCharge += processingFee;
      agentPortion += processingFee;

      applicationFeeAmount = platformPortion;
      supplierTransferAmount = upfrontStayPart;

      // SAFETY CHECK: Stripe application fee cannot exceed the total amount
      if (applicationFeeAmount >= amountToCharge) {
        applicationFeeAmount = Math.max(0, amountToCharge - 1); // Leave at least 1 cent margin
      }

      // Only card supports direct charges + application_fee_amount on Connect accounts
      // revolut_pay, paypal, customer_balance (bank_transfer) require platform-side charges
      if (agentStripeAccount && paymentMethodResolved === 'card') {
        useDirectCharge = true;
      }
    }

    // ---- Editor (captatore) commission split ----
    // Routing rules:
    //  - selfManagedEditor: villa.owner_id is an editor without an owners row.
    //      Editor receives upfrontStayPart + editor commission; settles real owner manually.
    //  - 2-recipient split: villa has a real owner with split_enabled + linked editor.
    //  - Legacy: supplierTransferAmount -> ownerStripeAccount (single-supplier path).
    let ownerTransferAmount = 0;
    let ownerTransferAccount: string | null = null;
    let editorTransferAmount = 0;
    let editorTransferAccount: string | null = null;

    if (type !== 'security_deposit' && isVilla && ownerStripeAccount) {
      // Resolve absolute editor (capturer) share. Quote-level override is
      // always %; otherwise honour villa-level mode (percent or fixed €).
      const editorShare = quoteOverridePct != null || capMode === 'percent'
        ? supplierBase * (editorMarkupPct / 100)
        : capAmount;

      if (selfManagedEditor) {
        // Editor IS the owner-side recipient — receives both stay portion and
        // commission. capIncluded irrelevant: same wallet anyway.
        ownerTransferAccount = ownerStripeAccount;
        ownerTransferAmount = supplierTransferAmount + (capIncluded ? 0 : editorShare);
        supplierTransferAmount = 0;
      } else if (ownerSplitEnabled && editorAgentId && editorStripeAccount) {
        // capIncluded=true  → commission already inside supplierBase, deduct from owner.
        // capIncluded=false → commission added on top, owner keeps full stay portion.
        const ownerShareRaw = capIncluded
          ? Math.max(0, supplierTransferAmount - editorShare)
          : supplierTransferAmount;
        ownerTransferAccount = ownerStripeAccount;
        ownerTransferAmount = ownerShareRaw;
        editorTransferAccount = editorStripeAccount;
        editorTransferAmount = editorShare;
        supplierTransferAmount = 0;
      }
      // else: legacy single-owner path keeps supplierTransferAmount; routed below.
    }

    if (isNaN(amountToCharge) || amountToCharge <= 0) {
      throw new Error(`Invalid amount: ${amountToCharge}`);
    }

    // ---- Customer management ----
    const clientEmail = quote.clients?.email?.trim();
    const clientName = quote.clients?.full_name || 'Valued Client';
    const stripeOptions = useDirectCharge ? { stripeAccount: agentStripeAccount } : undefined;

    let stripeCustomerId: string | undefined;
    if (clientEmail) {
      const customers = await stripe.customers.list({ email: clientEmail, limit: 1 }, stripeOptions);
      if (customers.data.length > 0) {
        stripeCustomerId = customers.data[0].id;
      }
    }
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        ...(clientEmail ? { email: clientEmail } : {}),
        name: clientName,
        metadata: { quote_id: quoteId },
      }, stripeOptions);
      stripeCustomerId = customer.id;
    }

    // ---- Session config ----
    const paymentTypeParam = type === 'security_deposit' ? 'security_deposit_auth' : 'deposit';

    const commonMetadata: Record<string, string> = {
      quote_id: quoteId,
      quoteId,
      payment_type: paymentTypeParam,
      type,
      use_direct_charge: useDirectCharge ? 'true' : 'false',
    };

    if (useDirectCharge && supplierTransferAmount > 0 && ownerStripeAccount) {
      commonMetadata.supplier_transfer_amount = String(Math.round(supplierTransferAmount * 100));
      commonMetadata.supplier_account = ownerStripeAccount;
    }

    if (useDirectCharge && ownerTransferAccount && ownerTransferAmount > 0) {
      commonMetadata.owner_transfer_amount = String(Math.round(ownerTransferAmount * 100));
      commonMetadata.owner_account = ownerTransferAccount;
    }
    if (useDirectCharge && editorTransferAccount && editorTransferAmount > 0) {
      commonMetadata.editor_transfer_amount = String(Math.round(editorTransferAmount * 100));
      commonMetadata.editor_account = editorTransferAccount;
    }

    const sessionConfig: any = {
      customer: stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: displayName,
              description: `Reservation for ${displayName} from ${new Date(quote.check_in).toLocaleDateString()} to ${new Date(quote.check_out).toLocaleDateString()}`,
            },
            unit_amount: Math.round(amountToCharge * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${origin}/quote/${quoteId}?success=true&payment_type=${paymentTypeParam}`,
      cancel_url: `${origin}/quote/${quoteId}?canceled=true`,
      metadata: commonMetadata,
    };

    if (type === 'security_deposit' || paymentMethodResolved === 'card') {
      sessionConfig.payment_method_types = ['card'];
      sessionConfig.payment_intent_data = {
        setup_future_usage: 'off_session',
        metadata: commonMetadata,
      };
      if (type === 'security_deposit') {
        sessionConfig.payment_intent_data.capture_method = 'manual';
      }
    } else if (paymentMethodResolved === 'revolut') {
      sessionConfig.payment_method_types = ['revolut_pay'];
      sessionConfig.payment_intent_data = { metadata: commonMetadata };
    } else if (paymentMethodResolved === 'bank_transfer') {
      sessionConfig.payment_method_types = ['customer_balance'];
      sessionConfig.payment_method_options = {
        customer_balance: {
          funding_type: 'bank_transfer',
          bank_transfer: {
            type: 'eu_bank_transfer',
            eu_bank_transfer: { country: 'DE' },
          },
        },
      };
      sessionConfig.payment_intent_data = { metadata: commonMetadata };
    }

    if (useDirectCharge && applicationFeeAmount > 0) {
      sessionConfig.payment_intent_data = sessionConfig.payment_intent_data || { metadata: commonMetadata };
      sessionConfig.payment_intent_data.application_fee_amount = Math.round(applicationFeeAmount * 100);
    }

    console.log('DEBUG: Creating session', {
      useDirectCharge,
      agentStripeAccount,
      amountToCharge,
      applicationFeeAmount,
      supplierTransferAmount,
      ownerStripeAccount,
    });

    const session = await stripe.checkout.sessions.create(sessionConfig, stripeOptions);

    return new Response(
      JSON.stringify({ id: session.id, url: session.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('ERROR: Stripe Checkout Error:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        detail: error.raw?.message || error.stack || 'Check server logs for details',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
