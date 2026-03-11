import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .reduce((acc, line) => {
        const [key, value] = line.split('=');
        if (key && value) acc[key.trim()] = value.trim();
        return acc;
    }, {});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function checkBuckets() {
    console.log("Checking buckets...");
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) {
        return { error: error.message };
    } else {
        return { buckets: buckets.map(b => b.name) };
    }
}

async function run() {
    const results = await checkBuckets();
    fs.writeFileSync('storage_results.json', JSON.stringify(results, null, 2));
    console.log("Storage results written to storage_results.json");
}

run();
