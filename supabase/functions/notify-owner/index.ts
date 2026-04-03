import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { quoteId, action, message } = await req.json();

    // Fetch quote details
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        id,
        status,
        final_price,
        agent_id,
        invenio_properties (villa_name, owner_id),
        invenio_boats (boat_name, owner_id),
        clients (full_name)
      `)
      .eq('id', quoteId)
      .single();

    if (quoteError || !quote) throw quoteError || new Error('Quote not found');

    const ownerId = quote.invenio_properties?.owner_id || quote.invenio_boats?.owner_id;
    const assetName = quote.invenio_properties?.villa_name || quote.invenio_boats?.boat_name;
    const clientName = quote.clients?.full_name;

    // Logic for notifications
    let recipientId = null;
    let notificationTitle = '';
    let notificationBody = '';

    if (action === 'request_approval') {
      recipientId = ownerId;
      notificationTitle = 'New Stay Approval Requested';
      notificationBody = `An agent has requested approval for ${clientName} at ${assetName}. Total: €${quote.final_price?.toLocaleString()}.`;
    } else if (action === 'approve') {
      recipientId = quote.agent_id;
      notificationTitle = 'Stay Approved by Owner';
      notificationBody = `The owner has approved the stay for ${clientName} at ${assetName}. You can now proceed with the contract.`;
    } else if (action === 'decline') {
      recipientId = quote.agent_id;
      notificationTitle = 'Stay Declined by Owner';
      notificationBody = `The owner has declined the stay for ${clientName} at ${assetName}. Reason: ${message || 'No reason provided'}.`;
    } else if (action === 'request_details') {
      recipientId = quote.agent_id;
      notificationTitle = 'Additional Details Requested';
      notificationBody = `The owner has requested more details about ${clientName} for their stay at ${assetName}. Message: ${message}.`;
    }

    if (recipientId) {
      // In a real app, you'd fetch the user's email and send it via SES/Resend
      // Or create a record in a 'notifications' table
      console.log(`[NOTIFICATION] To: ${recipientId} | Title: ${notificationTitle} | Body: ${notificationBody}`);
      
      // Attempt to create a notification record if the table exists (swallow error if it doesn't)
      await supabase.from('notifications').insert({
        user_id: recipientId,
        title: notificationTitle,
        content: notificationBody,
        type: 'quote_approval',
        metadata: { quoteId, action }
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
})
