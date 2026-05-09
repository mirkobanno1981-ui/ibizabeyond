import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.12.0?target=deno'

// Stripe Connect Payment Flow — single source of truth.
//
// All money math lives in src/lib/quoteMath.js and is snapshotted onto the
// quote row at save time:
//   supplier_base_price, editor_share_eur, editor_included,
//   extras_total_eur, agency_profit_eur, platform_profit_eur,
//   iva_amount_eur, iva_percent, stripe_fee_eur, upfront_stay_eur,
//   final_price.
//
// This function does NOT recompute. It reads the snapshot, splits the charge
// into Stripe transfers, and trusts the modal's numbers.
//
// Cash flow (booking deposit, type !== 'security_deposit'):
//   amountToCharge      = (final_price − supplier_base_price) + upfront_stay_eur
//                       = agency_profit + platform_profit + extras + iva (all 3) + stripe_fee + upfront_stay
//   application_fee     = platform_profit + platform_iva + (upfront_stay if not transferred separately)
//   ownerTransfer       = upfront_stay − editor_share (if editor_included) else upfront_stay
//   editorTransfer      = editor_share + editor_iva (only when not included; editor invoices IVA)
//   agent retains       = agency_profit + agency_iva + extras + stripe_fee  (on connected account)
//
// IVA is split per recipient: editor, agency, and platform each invoice their
// share of IVA on their own commission. The owner side (supplier_base) is the
// rental supplier and carries no IVA.
//
// For security_deposit we hold the deposit amount on the platform with manual capture.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const toCents = (eur: number) => Math.round((Number(eur) || 0) * 100)

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
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        id,
        final_price,
        supplier_base_price,
        editor_share_eur,
        editor_included,
        extras_total_eur,
        agency_profit_eur,
        platform_profit_eur,
        editor_iva_eur,
        agency_iva_eur,
        platform_iva_eur,
        iva_amount_eur,
        iva_percent,
        stripe_fee_eur,
        upfront_stay_eur,
        agent_id,
        v_uuid,
        boat_uuid,
        check_in,
        check_out,
        clients ( full_name, email ),
        properties (
          villa_name,
          deposit,
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
          stripe_account_id
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

    const editorAgentId = isVilla ? quote.properties?.owners?.agent_id : null;

    // Edge case: villa.owner_id points to an agent (editor) row instead of an
    // owners row — they self-manage. Treat the editor as the owner-side recipient.
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

    // ---- Snapshot read (no recomputation) ----
    const supplierBase    = parseFloat(quote.supplier_base_price || 0);
    const finalPrice      = parseFloat(quote.final_price || 0);
    const editorShare     = parseFloat(quote.editor_share_eur || 0);
    const editorIncluded  = !!quote.editor_included;
    const upfrontStay     = parseFloat(quote.upfront_stay_eur || 0);
    const platformProfit  = parseFloat(quote.platform_profit_eur || 0);
    const editorIva       = parseFloat(quote.editor_iva_eur || 0);
    const platformIva     = parseFloat(quote.platform_iva_eur || 0);

    let amountToCharge = 0;
    let applicationFeeAmount = 0;
    let supplierTransferAmount = 0;
    let useDirectCharge = false;

    if (type === 'security_deposit') {
      amountToCharge = securityDepositAmount;
      paymentMethodResolved = 'card';
    } else {
      // Booking deposit: charge everything except the deferred 50% balance.
      amountToCharge = finalPrice - (supplierBase - upfrontStay);

      // Platform receives its commission + IVA on that commission. Editor and
      // agency invoice their own IVA portions and receive them via transfers.
      applicationFeeAmount = platformProfit + platformIva;

      // Owner-side stay portion routed via metadata; webhook creates transfer.
      supplierTransferAmount = upfrontStay;

      // SAFETY: application fee can never exceed amount charged.
      if (applicationFeeAmount >= amountToCharge) {
        applicationFeeAmount = Math.max(0, amountToCharge - 1);
      }

      // Direct charges + application_fee_amount only work for card on Connect.
      if (agentStripeAccount && paymentMethodResolved === 'card') {
        useDirectCharge = true;
      }
    }

    // ---- Editor (capturer) commission split ----
    // editor_included = true  → editorShare already inside supplierBase, deduct from owner.
    //                           No editor IVA (commission is internal owner/editor split).
    // editor_included = false → editor receives editorShare + editor_iva (invoices IVA on its commission).
    let ownerTransferAmount = 0;
    let ownerTransferAccount: string | null = null;
    let editorTransferAmount = 0;
    let editorTransferAccount: string | null = null;

    if (type !== 'security_deposit' && isVilla && ownerStripeAccount) {
      if (selfManagedEditor) {
        // Editor IS the owner-side recipient — receives stay portion + commission + editor IVA.
        ownerTransferAccount = ownerStripeAccount;
        ownerTransferAmount = supplierTransferAmount
          + (editorIncluded ? 0 : editorShare + editorIva);
        supplierTransferAmount = 0;
      } else if (ownerSplitEnabled && editorAgentId && editorStripeAccount) {
        const ownerShare = editorIncluded
          ? Math.max(0, supplierTransferAmount - editorShare)
          : supplierTransferAmount;
        ownerTransferAccount = ownerStripeAccount;
        ownerTransferAmount = ownerShare;
        editorTransferAccount = editorStripeAccount;
        // Editor receives commission + its IVA portion (only when commission is
        // added on top — when included, the share is internal owner-side split).
        editorTransferAmount = editorIncluded ? 0 : editorShare + editorIva;
        supplierTransferAmount = 0;
      }
      // else: legacy single-owner path keeps supplierTransferAmount; routed below.
    }

    if (isNaN(amountToCharge) || amountToCharge <= 0) {
      throw new Error(`Invalid amount: ${amountToCharge}`);
    }

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

    const paymentTypeParam = type === 'security_deposit' ? 'security_deposit_auth' : 'deposit';

    const commonMetadata: Record<string, string> = {
      quote_id: quoteId,
      quoteId,
      payment_type: paymentTypeParam,
      type,
      use_direct_charge: useDirectCharge ? 'true' : 'false',
    };

    if (useDirectCharge && supplierTransferAmount > 0 && ownerStripeAccount) {
      commonMetadata.supplier_transfer_amount = String(toCents(supplierTransferAmount));
      commonMetadata.supplier_account = ownerStripeAccount;
    }
    if (useDirectCharge && ownerTransferAccount && ownerTransferAmount > 0) {
      commonMetadata.owner_transfer_amount = String(toCents(ownerTransferAmount));
      commonMetadata.owner_account = ownerTransferAccount;
    }
    if (useDirectCharge && editorTransferAccount && editorTransferAmount > 0) {
      commonMetadata.editor_transfer_amount = String(toCents(editorTransferAmount));
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
            unit_amount: toCents(amountToCharge),
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
      sessionConfig.payment_intent_data.application_fee_amount = toCents(applicationFeeAmount);
    }

    console.log('DEBUG: Creating session', {
      useDirectCharge,
      agentStripeAccount,
      amountToCharge,
      applicationFeeAmount,
      supplierTransferAmount,
      ownerTransferAmount,
      editorTransferAmount,
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
