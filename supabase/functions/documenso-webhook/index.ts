import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseKey);

        const payload = await req.json();
        console.log("Webhook received:", payload);

        // Standard Documenso Webhook payload indicates event type
        // Events like "document.completed" or "document.signed"
        // Let's assume the payload has `event`, and `document` object.
        const eventType = payload.event || payload.type;
        const document = payload.document || payload.data;

        if (!document) {
            throw new Error("No document data in payload");
        }

        const documentId = document.id || document.documentId;
        
        // We only care if it's completed / signed
        if (eventType === 'document.completed' || document.status === 'COMPLETED' || document.status === 'SIGNED') {
            
            // 1. Find Quote by documenso_document_id
            const { data: quote, error: quoteErr } = await supabase
                .from('quotes')
                .select('*')
                .eq('documenso_document_id', documentId)
                .single();

            if (quoteErr || !quote) {
                console.error("Quote not found for document ID:", documentId);
                // Return 200 anyway to prevent webhook retries from Documenso
                return new Response(JSON.stringify({ received: true, ignored: true }), { headers: corsHeaders });
            }

            // 2. Update status to contract_signed
            await supabase
                .from('quotes')
                .update({ status: 'contract_signed' })
                .eq('id', quote.id);

            // 3. Trigger Automated Billing (Stripe Invoice)
            // Notice: We invoke the existing stripe-create-invoice function automatically!
            console.log("Triggering automated invoice for Quote:", quote.id);
            
            // Note: Since edge environments can't always invoke other edge functions via standard supabase-js seamlessly 
            // without providing auth headers of valid user, we'll use a direct fetch to the edge function URL
            // using the Service Role Key.
            const invoiceUrl = `${supabaseUrl}/functions/v1/stripe-create-invoice`;
            const invoiceRes = await fetch(invoiceUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ quoteId: quote.id })
            });

            if (!invoiceRes.ok) {
                const errText = await invoiceRes.text();
                console.error("Failed to automatically trigger invoice:", errText);
            } else {
                console.log("Successfully triggered invoice creation.");
            }

        }

        return new Response(JSON.stringify({ success: true }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });

    } catch (error) {
        console.error("Webhook Error:", error);
        // Always return 200 for webhooks unless it's a fatal validation issue, to stop retries.
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
        });
    }
});
