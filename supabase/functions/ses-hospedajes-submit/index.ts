import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { quoteId } = await req.json()
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Fetch quote, property/boat, guests and owner credentials
    const { data: quote, error: quoteErr } = await supabaseClient
      .from('quotes')
      .select('*, invenio_properties(*, owners(*)), invenio_boats(*, owners(*))')
      .eq('id', quoteId)
      .single()

    if (quoteErr) throw new Error(`Quote not found: ${quoteErr.message}`)
    
    const { data: guests, error: guestsErr } = await supabaseClient
      .from('guests')
      .select('*')
      .eq('quote_id', quoteId)

    if (guestsErr) throw new Error(`Database error fetching guests: ${guestsErr.message}`)
    if (!guests || guests.length === 0) {
      throw new Error('No guest data found. Please ensure the traveler registration form has been completed.')
    }

    // 2. Extract Configuration (handle both Property and Boat)
    const property = quote.invenio_properties
    const boat = quote.invenio_boats
    const owner = property?.owners || boat?.owners
    
    const sesUser = owner?.ses_user
    const sesPassword = owner?.ses_password
    const establishmentCode = property?.ses_establishment_code || boat?.ses_establishment_code

    if (!sesUser || !sesPassword) {
      throw new Error(`The owner (${owner?.name || 'Unknown'}) has not configured SES credentials in their profile.`)
    }
    
    if (!establishmentCode) {
      throw new Error('The property/boat does not have a SES Establishment Code assigned.')
    }

    // 3. Construct JSON Payload
    const payload = {
      identificador_establecimiento: establishmentCode,
      tipo_comunicacion: 'H',
      partes: guests.map(g => ({
        nombre: g.first_name || g.full_name?.split(' ')[0] || 'Guest',
        primer_apellido: g.last_name1 || g.full_name?.split(' ').slice(1).join(' ') || '—',
        segundo_apellido: g.last_name2 || '',
        tipo_documento: g.id_type || 'P',
        numero_documento: g.id_number,
        fecha_nacimiento: g.dob,
        pais_nacionalidad: g.nationality || 'ESP',
        sexo: g.gender || 'M',
        fecha_expedicion_documento: null, 
        fecha_inicio_estancia: quote.check_in,
        fecha_fin_estancia: quote.check_out,
        relacion_parentezco: g.relationship || 'T',
        es_titular: g.is_main_guest
      }))
    }

    // 4. Transmission
    const SES_ENDPOINT = 'https://ses.hospedajes.es/api/v1/comunicar';
    let submissionId = 'SES-ERR-' + Date.now().toString(36).toUpperCase();
    let isReal = false;

    try {
      const response = await fetch(SES_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${btoa(`${sesUser}:${sesPassword}`)}`
        },
        body: JSON.stringify(payload)
      })
      
      const result = await response.json().catch(() => ({}));

      if (response.ok) {
        submissionId = result.id_comunicacion || result.id || submissionId;
        isReal = true;
      } else {
        console.error(`SES API Error: ${response.status}`, result);
        throw new Error(result.mensaje || `SES API Error ${response.status}: ${response.statusText}`);
      }
    } catch (apiErr) {
      console.warn('SES Transmission failed:', apiErr.message);
      
      await supabaseClient
        .from('quotes')
        .update({
          ses_status: 'error',
          ses_error: apiErr.message,
        })
        .eq('id', quoteId)
        
      throw apiErr;
    }

    // 5. Update success
    await supabaseClient
      .from('quotes')
      .update({
        ses_status: 'sent',
        ses_submission_id: submissionId,
        ses_error: null,
      })
      .eq('id', quoteId)

    return new Response(JSON.stringify({ 
      success: true, 
      code: submissionId,
      is_real: isReal,
      message: 'Transmission successful.'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Edge Function Error:', error.message)
    
    return new Response(JSON.stringify({ 
      success: false, 
      message: error.message 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
