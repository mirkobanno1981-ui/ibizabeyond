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
        const documensoApiKey = Deno.env.get('DOCUMENSO_API_KEY') || '';
        const documensoTemplateId = Deno.env.get('DOCUMENSO_TEMPLATE_ID') || ''; 

        const supabase = createClient(supabaseUrl, supabaseKey);

        const body = await req.json();
        const { quoteId, type } = body;
        
        console.log(`Function invoked for quoteId: ${quoteId}, type: ${type || 'agent'}`);

        if (!quoteId) throw new Error("Quote ID is required");

        // Fetch quote details with related client and property info
        const { data: quote, error: quoteErr } = await supabase
            .from('quotes')
            .select(`
                *,
                clients ( full_name, email, passport_id, address ),
                invenio_properties ( title, villa_name ),
                invenio_boats ( boat_name )
            `)
            .eq('id', quoteId)
            .single();

        if (quoteErr) throw quoteErr;
        if (!quote) throw new Error("Quote not found");

        // Fetch Agent Profile Profile
        const { data: agentProfile } = await supabase
            .from('agents')
            .select('*')
            .eq('id', quote.agent_id)
            .single();

        // Template Selection Logic
        let targetTemplateId = documensoTemplateId;
        if (quote.invenio_boat_id && agentProfile?.boat_contract_template) {
            targetTemplateId = agentProfile.boat_contract_template; 
        } else if (agentProfile?.contract_template) {
            targetTemplateId = agentProfile.contract_template; 
        }

        if (!targetTemplateId) {
            console.error("No template ID found for quote:", quoteId);
            throw new Error("No Documenso Template configured for this agent or property type.");
        }

        const isGuest = type === 'guest';
        let signerEmail = '';
        let signerName = '';

        if (isGuest) {
            // Guest Flow (B2C Rental Agreement)
            signerEmail = quote.clients?.email;
            signerName = quote.clients?.full_name || 'Valued Guest';
            console.log("Setting up Guest Signer:", signerEmail);
        } else {
            // Agent Flow (B2B Agency Agreement)
            if (!quote.agent_id) throw new Error("Agent ID missing for B2B contract");
            const { data: { user: agentUser }, error: agentUserErr } = await supabase.auth.admin.getUserById(quote.agent_id);
            if (agentUserErr) throw agentUserErr;
            signerEmail = agentUser.email;
            signerName = agentProfile?.company_name || agentUser.email;
            console.log("Setting up Agent Signer:", signerEmail);
        }

        if (!signerEmail) throw new Error("Signer email is missing. Check client or agent profile.");

        const propertyName = quote.invenio_properties?.title || quote.invenio_properties?.villa_name || quote.invenio_boats?.boat_name || "Unknown Property";
        const totalCost = quote.final_price || 0;
        
        // Prepare Documenso API Payload
        const payload = {
            templateId: Number(targetTemplateId),
            title: `${isGuest ? 'Rental Agreement' : 'B2B Contract'} - ${propertyName} - ${signerName}`,
            meta: { quoteId: quote.id, type: type || 'agent' }, 
            recipients: [
                {
                    email: signerEmail,
                    name: signerName,
                    role: "SIGNER"
                }
            ],
            formValues: {
                agency_name: agentProfile?.company_name || 'Ibiza Beyond',
                agency_vat: agentProfile?.agency_details || 'N/A',
                guest_name: quote.clients?.full_name || '',
                guest_passport: quote.clients?.passport_id || '',
                property_name: propertyName,
                check_in: quote.check_in || '',
                check_out: quote.check_out || '',
                total_price: `€${totalCost}`,
                deposit_amount: `€${(totalCost * 0.5).toFixed(2)}`
            }
        };

        console.log("Calling Documenso API v1...");
        
        // Documenso v1 API - Create Document from Template
        const docRes = await fetch(`https://app.documenso.com/api/v1/templates/${targetTemplateId}/create-document`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${documensoApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: payload.title,
                recipients: payload.recipients,
                meta: payload.meta,
                formValues: payload.formValues
            })
        });

        if (!docRes.ok) {
            const errBody = await docRes.text();
            console.error("Documenso API Error:", errBody);
            
            // Fallback for development/missing keys
            if (documensoApiKey.length < 5) {
                console.log("Mocking success because DOCUMENSO_API_KEY is missing or invalid.");
                const mockId = `mock_${Date.now()}`;
                await supabase.from('quotes').update({ 
                    status: isGuest ? quote.status : 'contract_sent', 
                    documenso_document_id: mockId 
                }).eq('id', quoteId);

                return new Response(JSON.stringify({ 
                    success: true, 
                    mocked: true, 
                    signingUrl: `https://app.documenso.com/sign/mock_token_${mockId}` 
                }), { 
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
                });
            }
            throw new Error(`Documenso API returned ${docRes.status}: ${errBody}`);
        }

        const docData = await docRes.json();
        const documentId = docData.id;
        
        // Extract signing token for the recipient (to form the signingUrl)
        const recipient = docData.recipients?.find((r: any) => r.email === signerEmail);
        const token = recipient?.token;
        const signingUrl = token ? `https://app.documenso.com/sign/${token}` : null;

        console.log("Document created successfully. ID:", documentId);

        // Update Quote with new status and document ID
        const updatePayload: any = { documenso_document_id: String(documentId) };
        if (!isGuest) {
            updatePayload.status = 'contract_sent';
        } else {
            // If guest signed, we might want to update contract_signed to true already or via webhook
        }

        await supabase
            .from('quotes')
            .update(updatePayload)
            .eq('id', quoteId);

        return new Response(JSON.stringify({ 
            success: true, 
            documentId, 
            signingUrl 
        }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });

    } catch (error) {
        console.error("Function Error:", error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400
        });
    }
});
