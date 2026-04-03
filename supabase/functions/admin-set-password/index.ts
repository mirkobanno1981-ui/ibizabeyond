import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    // 1. Get current user (caller) to verify role
    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: caller }, error: userError } = await supabaseClient.auth.getUser(token)

    if (userError || !caller) {
        throw new Error('Unauthorized')
    }

    // 2. Check if caller is admin or super_admin
    const { data: roleData } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', caller.id)
      .single()

    if (roleData?.role !== 'admin' && roleData?.role !== 'super_admin') {
      // Check hardcoded bypass for Invenio
      if (caller.id !== '72241c14-09ed-4227-a01e-9bdeefdd0c8d') {
        throw new Error('Unauthorized: Insufficient permissions')
      }
    }

    // 3. Get request body
    const { userId, newPassword } = await req.json()

    if (!userId || !newPassword) {
      throw new Error('UserId and newPassword are required')
    }

    // 4. Update the user's password using Admin API
    const { data, error: updateError } = await supabaseClient.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    )

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({ message: 'Password updated successfully' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
