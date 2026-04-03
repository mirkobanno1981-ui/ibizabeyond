import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '/root/ibizabeyond/.env' })

const supa = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

async function go() {
    console.log("Testing quotes fetch...");
    const { data, error } = await supa
        .from('quotes')
        .select(`
            id, status, check_in, check_out, final_price, created_at,
            client_id,
            agent_id,
            agent_markup,
            extra_services,
            is_manual_price,
            stripe_fee_included,
            supplier_base_price,
            admin_markup,
            price_breakdown,
            clients(full_name, phone_number),
            invenio_properties(*),
            invenio_boats(*),
            agents(company_name, contract_template, boat_contract_template)
        `);
    if (error) {
        console.error("Quotes query failed:", error);
    } else {
        console.log("Quotes query succeeded. Got", data?.length, "quotes.");
    }
}
go();
