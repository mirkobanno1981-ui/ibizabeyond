import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.12.0?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPPORTED_COUNTRIES = ['IT', 'ES', 'FR', 'DE', 'NL', 'BE', 'PT', 'AT', 'IE', 'GB']

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')!
  const appOrigin = Deno.env.get('APP_ORIGIN') || 'https://ibizabeyond.com'

  const stripe = new Stripe(stripeSecret, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  })

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const body = await req.json()
    const { agentId, accountId: bodyAccountId, accountType, country } = body

    const targetType = accountType === 'owner' ? 'owner' : 'agent'
    const targetTable = targetType === 'owner' ? 'owners' : 'agents'
    const targetId = bodyAccountId || agentId

    if (!targetId) {
      return new Response(JSON.stringify({ error: 'Missing accountId / agentId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accountCountry = (country && SUPPORTED_COUNTRIES.includes(country)) ? country : 'IT'

    const selectCols = targetType === 'owner'
      ? 'id, name, email, company_name, stripe_account_id'
      : 'id, email, company_name, stripe_account_id'

    const { data: target, error: targetErr } = await supabase
      .from(targetTable)
      .select(selectCols)
      .eq('id', targetId)
      .single()

    if (targetErr || !target) {
      throw new Error(`${targetType} not found: ${targetErr?.message || 'unknown'}`)
    }

    let stripeAccountId = target.stripe_account_id

    if (stripeAccountId) {
      try {
        const existing = await stripe.accounts.retrieve(stripeAccountId)
        if (existing.charges_enabled && existing.details_submitted) {
          return new Response(JSON.stringify({
            accountId: stripeAccountId,
            onboarded: true,
            message: 'Account already onboarded',
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      } catch (_e) {
        stripeAccountId = null
      }
    }

    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: accountCountry,
        email: target.email || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'company',
        business_profile: {
          name: target.company_name || (targetType === 'owner' ? (target as any).name : undefined) || undefined,
        },
        metadata: {
          [`${targetType}_id`]: target.id,
          account_type: targetType,
        },
      })
      stripeAccountId = account.id

      const { error: updErr } = await supabase
        .from(targetTable)
        .update({ stripe_account_id: stripeAccountId })
        .eq('id', target.id)

      if (updErr) {
        console.error('Failed to save stripe_account_id:', updErr)
      }
    }

    const accountId = stripeAccountId

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appOrigin}/profile?stripe_connect=refresh`,
      return_url: `${appOrigin}/profile?stripe_connect=success`,
      type: 'account_onboarding',
    })

    return new Response(JSON.stringify({
      accountId,
      url: accountLink.url,
      onboarded: false,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('stripe-connect-express error:', e)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
