import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.12.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    return new Response('No signature', { status: 400 })
  }

  try {
    const body = await req.text()
    let event

    if (endpointSecret) {
      event = await stripe.webhooks.constructEventAsync(body, signature, endpointSecret)
    } else {
      // For development/testing without secret
      event = JSON.parse(body)
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const paymentIntentId = session.payment_intent as string
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
      
      const quoteId = paymentIntent.metadata.quote_id
      const paymentType = paymentIntent.metadata.payment_type

      if (quoteId) {
        console.log(`Payment confirmed for Quote ID: ${quoteId} (Type: ${paymentType})`)
        
        let updates: any = {};
        
        if (paymentType === 'security_deposit_auth') {
          updates = {
            security_deposit_authorized: true,
            security_deposit_intent_id: paymentIntentId
          };
        } else {
          // Default: Reservation Deposit (Acconto)
          // Payment + accepted terms = legally binding contract signature
          updates = {
            status: 'booked',
            payment_status: 'paid',
            deposit_paid: true,
            contract_signed: true  // Payment constitutes digital signature of rental agreement
          };
        }

        const { error } = await supabaseAdmin
          .from('quotes')
          .update(updates)
          .eq('id', quoteId)

        if (error) {
          console.error(`Error updating quote ${quoteId}:`, error)
          throw error
        }
      } else {
        console.warn('No quoteId found in metadata for session:', session.id)
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }
})
