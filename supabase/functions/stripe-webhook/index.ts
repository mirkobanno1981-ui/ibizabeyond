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
    let event: any

    if (endpointSecret) {
      event = await stripe.webhooks.constructEventAsync(body, signature, endpointSecret)
    } else {
      event = JSON.parse(body)
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // event.account is set when event originates from a connected account (direct charge)
    const connectedAccountId: string | undefined = event.account

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const paymentIntentId = session.payment_intent as string

      const retrieveOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined
      const paymentIntent = paymentIntentId
        ? await stripe.paymentIntents.retrieve(paymentIntentId, undefined, retrieveOptions)
        : null

      const md = { ...(session.metadata || {}), ...(paymentIntent?.metadata || {}) }
      const quoteId = md.quote_id || md.quoteId
      const paymentType = md.payment_type || md.type
      const useDirectCharge = md.use_direct_charge === 'true'
      const invenioTransferAmount = md.invenio_transfer_amount ? parseInt(md.invenio_transfer_amount, 10) : 0
      const invenioAccount = md.invenio_account
      const ownerTransferAmount = md.owner_transfer_amount ? parseInt(md.owner_transfer_amount, 10) : 0
      const ownerAccount = md.owner_account
      const editorTransferAmount = md.editor_transfer_amount ? parseInt(md.editor_transfer_amount, 10) : 0
      const editorAccount = md.editor_account

      if (!quoteId) {
        console.warn('No quoteId found in metadata for session:', session.id)
        return new Response(JSON.stringify({ received: true }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })
      }

      console.log(`Payment confirmed for Quote ID: ${quoteId} (Type: ${paymentType}, Direct: ${useDirectCharge})`)

      // ---- Transfer routing ----
      // Direct charge → application_fee lands on platform; transfer remaining shares.
      // Legacy single-owner path: invenio_* metadata.
      // New split path: owner_* and/or editor_* metadata (overrides invenio_*).
      const transfers: Array<{ amount: number; account: string; label: string }> = []

      if (useDirectCharge) {
        if (ownerTransferAmount > 0 && ownerAccount) {
          transfers.push({ amount: ownerTransferAmount, account: ownerAccount, label: 'owner' })
        }
        if (editorTransferAmount > 0 && editorAccount) {
          transfers.push({ amount: editorTransferAmount, account: editorAccount, label: 'editor' })
        }
        if (transfers.length === 0 && invenioTransferAmount > 0 && invenioAccount) {
          transfers.push({ amount: invenioTransferAmount, account: invenioAccount, label: 'invenio_legacy' })
        }
      }

      for (const t of transfers) {
        try {
          const transfer = await stripe.transfers.create({
            amount: t.amount,
            currency: session.currency || 'eur',
            destination: t.account,
            description: `${t.label} share for Quote ${quoteId}`,
            metadata: {
              quote_id: quoteId,
              source_session: session.id,
              source_payment_intent: paymentIntentId || '',
              transfer_label: t.label,
            },
          })
          console.log(`Transfer ${t.label} -> ${t.account}: ${transfer.id} (${t.amount} cents)`)
        } catch (e: any) {
          console.error(`Transfer ${t.label} failed:`, e.message)
          // Do not throw — payment already captured; flag for manual recovery
        }
      }

      // ---- Update quote status ----
      const updates: any = paymentType === 'security_deposit_auth'
        ? {
            security_deposit_authorized: true,
            security_deposit_intent_id: paymentIntentId,
          }
        : {
            status: 'booked',
            payment_status: 'paid',
            deposit_paid: true,
            contract_signed: true,
          }

      const { error } = await supabaseAdmin
        .from('quotes')
        .update(updates)
        .eq('id', quoteId)

      if (error) {
        console.error(`Error updating quote ${quoteId}:`, error)
        throw error
      }

      // ---- Block villa nights in internal availability ----
      if (paymentType !== 'security_deposit_auth') {
        try {
          const { data: q } = await supabaseAdmin
            .from('quotes')
            .select('v_uuid, check_in, check_out, clients(full_name)')
            .eq('id', quoteId)
            .single()

          if (q?.v_uuid && q.check_in && q.check_out) {
            const guest = (q as any).clients?.full_name || 'Booking'
            await supabaseAdmin
              .from('villa_blocked_dates')
              .delete()
              .eq('v_uuid', q.v_uuid)
              .eq('start_date', q.check_in)
              .eq('end_date', q.check_out)
              .eq('summary', `Booked: ${guest} (Quote ${quoteId})`)

            const { error: blockErr } = await supabaseAdmin
              .from('villa_blocked_dates')
              .insert([{
                v_uuid: q.v_uuid,
                start_date: q.check_in,
                end_date: q.check_out,
                summary: `Booked: ${guest} (Quote ${quoteId})`,
                synced_at: new Date().toISOString(),
              }])
            if (blockErr) console.error('Block-dates insert failed:', blockErr)
            else console.log(`Blocked ${q.check_in} -> ${q.check_out} for villa ${q.v_uuid}`)
          }
        } catch (e: any) {
          console.error('Auto-block villa dates failed:', e.message)
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }
})
