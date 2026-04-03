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
  } catch (e) {
    // Empty body 
  }

  const { quoteId, type, method } = body;
  console.log('DEBUG: Received request:', { quoteId, type, method });

  if (!quoteId) {
    console.error('DEBUG: Missing quoteId');
    return new Response(JSON.stringify({ error: 'Missing quoteId' }), { 
      status: 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }

  try {
    // 1. Fetch Quote & Related Data
    console.log('DEBUG: Fetching quote details for ID:', quoteId);
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        id,
        final_price,
        supplier_base_price,
        agent_id,
        v_uuid,
        boat_uuid,
        check_in,
        check_out,
        extra_services,
        clients ( full_name, email ),
        invenio_properties (
          villa_name,
          deposit
        ),
        invenio_boats (
          boat_name,
          security_deposit
        )
      `)
      .eq('id', quoteId)
      .single();

    if (quoteError || !quote) {
      console.error('ERROR: Quote not found or fetch error:', quoteError);
      throw new Error(`Quote not found: ${quoteError?.message || 'Unknown error'}`);
    }

    // Determine if it's a Villa or Boat
    const isVilla = !!quote.v_uuid;
    const isBoat = !!quote.boat_uuid;
    const displayName = isVilla 
      ? (quote.invenio_properties?.villa_name || 'Villa Reservation') 
      : (quote.invenio_boats?.boat_name || 'Boat Charter');
    
    const securityDepositAmount = isVilla 
      ? parseFloat(quote.invenio_properties?.deposit || 0) 
      : parseFloat(quote.invenio_boats?.security_deposit || 0);

    console.log(`DEBUG: Processing for ${isVilla ? 'Villa' : 'Boat'}: ${displayName}`);

    const origin = req.headers.get('origin') || 'https://ibizabeyond.it';
    let amountToCharge = 0;
    
    // 2. Calculate Amount to Charge based on payment type
    let paymentMethodResolved = method || 'card';

    if (type === 'security_deposit') {
      amountToCharge = securityDepositAmount;
      paymentMethodResolved = 'card'; // Always force card for security deposits
    } else {
      // Logic for Booking Deposit (Upfront Payment)
      const totalPrice = parseFloat(quote.final_price);
      const supplierBase = parseFloat(quote.supplier_base_price || 0);

      // Check if booking is within 7 weeks (49 days) of check-in
      const checkInDate = new Date(quote.check_in);
      checkInDate.setUTCHours(0, 0, 0, 0);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const diffTime = checkInDate.getTime() - today.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
      const isLastMinute = diffDays <= 49;
      
      // Commissions (Markup) + Extras are platform-collected upfront
      const commissionsTotal = totalPrice - supplierBase;
      const upfrontStayPart = isLastMinute ? supplierBase : (supplierBase * 0.5); // 100% if last minute, 50% otherwise
      
      amountToCharge = commissionsTotal + upfrontStayPart;

      // Add 2% Credit Card Processing Fee if method is card
      if (paymentMethodResolved === 'card') {
        const cardFee = amountToCharge * 0.02;
        amountToCharge += cardFee;
        console.log(`DEBUG: Added 2% card fee. New total: ${amountToCharge} (Last Minute: ${isLastMinute})`);
      }
    }

    if (isNaN(amountToCharge) || amountToCharge <= 0) {
      console.error('ERROR: Invalid amount calculated:', { amountToCharge, type, quoteId, method: paymentMethodResolved });
      throw new Error(`Invalid amount: charge must be greater than 0 (Calculated: ${amountToCharge}).`);
    }

    // 3. Customer Management
    const clientEmail = quote.clients?.email?.trim();
    const clientName = quote.clients?.full_name || 'Valued Client';
    let stripeCustomerId: string | undefined;

    if (clientEmail) {
      console.log('DEBUG: Looking for existing Stripe customer:', clientEmail);
      const customers = await stripe.customers.list({ email: clientEmail, limit: 1 });
      if (customers.data.length > 0) {
        stripeCustomerId = customers.data[0].id;
        console.log('DEBUG: Found existing customer:', stripeCustomerId);
      }
    }

    if (!stripeCustomerId) {
      console.log('DEBUG: Creating new Stripe customer for quote:', quoteId);
      const customer = await stripe.customers.create({
        ...(clientEmail ? { email: clientEmail } : {}),
        name: clientName,
        metadata: { quoteId }
      });
      stripeCustomerId = customer.id;
    }

    // 4. Create Stripe Checkout Session
    console.log('DEBUG: Creating Stripe session for amount:', amountToCharge);
    
    const paymentTypeParam = type === 'security_deposit' ? 'security_deposit_auth' : 'deposit';

    const sessionConfig: any = {
      customer: stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: displayName,
              description: `Reservation for ${displayName} from ${new Date(quote.check_in).toLocaleDateString()} to ${new Date(quote.check_out).toLocaleDateString()} ${paymentMethodResolved === 'card' && type !== 'security_deposit' ? '(includes 2% processing fee)' : ''}`.trim(),
            },
            unit_amount: Math.round(amountToCharge * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${origin}/quote/${quoteId}?success=true&payment_type=${paymentTypeParam}`,
      cancel_url: `${origin}/quote/${quoteId}?canceled=true`,
      metadata: {
        quoteId,
        type,
      },
    };

    // Use dynamic payment methods for standard deposits, 
    // but force card for manual capture (security deposits)
    if (type === 'security_deposit' || paymentMethodResolved === 'card') {
      sessionConfig.payment_method_types = ['card'];
      sessionConfig.payment_intent_data = {
        setup_future_usage: 'off_session',
        metadata: {
          quoteId,
          type,
        }
      };
      
      if (type === 'security_deposit') {
        sessionConfig.payment_intent_data.capture_method = 'manual';
      }
    } else if (paymentMethodResolved === 'bank_transfer') {
      // For bank transfers, setup_future_usage is NOT supported for customer_balance/sepa in off_session mode easily.
      sessionConfig.payment_method_types = ['customer_balance'];
      sessionConfig.payment_method_options = {
        customer_balance: {
          funding_type: 'bank_transfer',
          bank_transfer: {
            type: 'eu_bank_transfer',
            eu_bank_transfer: {
              country: 'DE', // Setting a valid European country code. Stripe will provide a DE IBAN via customer_balance
            }
          },
        },
      };
      sessionConfig.payment_intent_data = {
        metadata: {
          quoteId,
          type,
        }
      };
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);
    console.log('DEBUG: Stripe session created successfully:', session.id);

    return new Response(
      JSON.stringify({ id: session.id, url: session.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('ERROR: Stripe Checkout Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        detail: error.raw?.message || error.stack || 'Check server logs for details'
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
