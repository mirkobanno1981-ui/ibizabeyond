import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  const appOrigin = Deno.env.get('APP_ORIGIN') || 'https://ibizabeyond.com'

  if (error) {
    return Response.redirect(
      `${appOrigin}/owners?stripe_connect=error&message=${encodeURIComponent(errorDescription || error)}`,
      302
    )
  }

  if (!code || !state) {
    return new Response(JSON.stringify({ error: 'Missing code or state' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')!
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const tokenRes = await fetch('https://connect.stripe.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_secret: stripeSecret,
        code,
        grant_type: 'authorization_code',
      }),
    })

    const tokenData = await tokenRes.json()

    if (!tokenRes.ok) {
      console.error('OAuth token exchange failed:', tokenData)
      throw new Error(tokenData.error_description || tokenData.error || 'Token exchange failed')
    }

    const stripeUserId: string = tokenData.stripe_user_id

    const { error: updateErr } = await supabase
      .from('owners')
      .update({ stripe_account_id: stripeUserId })
      .eq('id', state)

    if (updateErr) {
      console.error('DB update failed:', updateErr)
      throw new Error(`DB update failed: ${updateErr.message}`)
    }

    return Response.redirect(
      `${appOrigin}/owners?stripe_connect=success&account=${stripeUserId}`,
      302
    )
  } catch (e: any) {
    console.error('OAuth callback error:', e)
    return Response.redirect(
      `${appOrigin}/owners?stripe_connect=error&message=${encodeURIComponent(e.message)}`,
      302
    )
  }
})
