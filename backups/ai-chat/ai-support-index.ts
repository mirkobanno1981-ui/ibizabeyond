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
    const { message, history, userId } = await req.json();
    
    // 1. Get environment variables for LLM Backend (Open WebUI or fallback to OpenAI)
    const openWebUiUrl = Deno.env.get('OPEN_WEBUI_URL'); // e.g. http://host.docker.internal:8080/api/chat/completions
    const llmApiUrl = openWebUiUrl || 'https://api.openai.com/v1/chat/completions';
    
    // Fallback logic for API keys. Open WebUI local instance might not need one, but standard API needs it.
    const llmApiKey = Deno.env.get('OPEN_WEBUI_API_KEY') || Deno.env.get('OPENAI_API_KEY') || 'local-no-key';
    const llmModel = Deno.env.get('OPEN_WEBUI_MODEL') || 'gpt-4o-mini';

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    // Check Authorization header sent from the client
    const authHeader = req.headers.get('Authorization');

    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2. Initialize Supabase client using the USER's JWT Token
    // This is the most critical part: It guarantees that all subsequent queries 
    // are executed with the user's RLS permissions (Agent sees only own data, Admin sees team data, etc.)
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // 3. Gather Context securely
    let context = "";

    // General products search
    if (message.toLowerCase().includes("villa") || message.toLowerCase().includes("boat") || message.toLowerCase().includes("search") || message.toLowerCase().includes("find") || message.toLowerCase().includes("property")) {
      const { data: villas } = await supabase.from('invenio_properties').select('villa_name, bedrooms, sleeps, areaname, tagline').limit(10);
      const { data: boats } = await supabase.from('invenio_boats').select('boat_name, type, length_ft, daily_price').limit(5);
      
      if (villas && villas.length > 0) {
        context += "Available Villas: " + villas.map(v => `${v.villa_name} (${v.bedrooms}BR, sleeps ${v.sleeps}) in ${v.areaname}`).join(", ") + "\n";
      }
      if (boats && boats.length > 0) {
        context += "Available Boats: " + boats.map(b => `${b.boat_name} (${b.type}, ${b.length_ft}ft, €${b.daily_price}/day)`).join(", ") + "\n";
      }
    }

    // Agent/Admin specific requests (clients, quotes, bookings)
    // The query omits filters like agent_id because RLS handles it dynamically based on the JWT
    if (message.toLowerCase().includes("quote") || message.toLowerCase().includes("booking") || message.toLowerCase().includes("client") || message.toLowerCase().includes("preventiv")) {
      const { data: quotes } = await supabase
        .from('quotes')
        .select(`
          id, status, check_in, check_out, total_price,
          invenio_properties(villa_name),
          clients(full_name, email),
          agents(full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(10);

      if (quotes && quotes.length > 0) {
        context += "\nRelevant Quotes (filtered by permissions): " + quotes.map(q => 
          `Quote ${q.id} (Status: ${q.status}): Client ${q.clients?.full_name} for Property ${q.invenio_properties?.villa_name} from ${q.check_in} to ${q.check_out}. Agent: ${q.agents?.full_name}. Total: €${q.total_price || 0}`
        ).join("; \n") + "\n";
      } else {
        context += "\nNo relevant quotes found or you do not have permission to view them.\n";
      }
      
      const { data: clients } = await supabase
        .from('clients')
        .select('full_name, email, phone')
        .limit(10);
        
      if (clients && clients.length > 0) {
        context += "\nRelevant Clients (filtered by permissions): " + clients.map(c => 
          `${c.full_name} (${c.email}, ${c.phone})`
        ).join("; ") + "\n";
      }
    }

    // 4. Call Open WebUI / OpenAI API
    const response = await fetch(llmApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${llmApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: llmModel,
        messages: [
          { role: 'system', content: `You are the Ibiza Beyond AI Assistant. You help agents and agency admins manage their clients, quotes, and property searches based on strictly provided context.
          
          Context Data from the Database (filtered by user's security permissions):
          ${context}
          
          Only provide information that relies on the context provided above. Keep responses professional, helpful, accurate, and concise. Use markdown for lists or bold text. Answer in the same language the user uses.` },
          ...history,
          { role: 'user', content: message }
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`LLM API Error (${response.status}):`, errorText);
      throw new Error(`LLM API Error: ${response.statusText}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "I'm having trouble processing that right now.";

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('AI Support Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
})

