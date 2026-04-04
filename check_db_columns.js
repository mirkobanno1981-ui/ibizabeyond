
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('c:/Users/mirko/Documents/Ibiza Beyond/.env.local', 'utf8')
    .split('\n')
    .reduce((acc, line) => {
        const [key, value] = line.split('=');
        if (key && value) acc[key.trim()] = value.trim();
        return acc;
    }, {});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function checkColumns() {
    console.log("Checking columns for table: quotes");
    try {
        const { data, error } = await supabase.from('quotes').select('*').limit(1);
        if (error) {
            console.error("Error fetching quotes:", error.message);
            return;
        }

        if (data && data.length > 0) {
            console.log("Actual columns in 'quotes' table:", Object.keys(data[0]));
        } else {
            console.log("No data. Attempting a dry-run insert to identify missing columns...");
            const dummyQuote = {
                v_uuid: '00000000-0000-0000-0000-000000000000',
                client_id: '00000000-0000-0000-0000-000000000000',
                check_in: '2026-04-04',
                check_out: '2026-04-11',
                group_details: { type: 'family' }
            };
            const { error: insErr } = await supabase.from('quotes').insert(dummyQuote);
            if (insErr) {
                console.error("Insert failed:", insErr.message);
            } else {
                console.log("Insert worked? This means group_details might exist.");
            }
        }
    } catch (err) {
        console.error("Script failed:", err.message);
    }
}

checkColumns();
