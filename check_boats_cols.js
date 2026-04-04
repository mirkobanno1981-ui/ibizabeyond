import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .reduce((acc, line) => {
        const [key, value] = line.split('=');
        if (key && value) {
            let k = key.trim();
            let v = value.trim();
            if (v.startsWith('"') && v.endsWith('"')) v = v.substring(1, v.length-1);
            acc[k] = v;
        }
        return acc;
    }, {});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function checkCols() {
    console.log("Fetching boat sample...");
    const { data, error } = await supabase.from('invenio_boats').select('*').limit(1);
    if (error) {
        console.log("Error:", error);
    } else if (data && data.length > 0) {
        console.log("Columns:", Object.keys(data[0]));
    } else {
        console.log("No boats found in invenio_boats table.");
    }
}

checkCols();
