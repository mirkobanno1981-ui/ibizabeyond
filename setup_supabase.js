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

async function setup() {
    console.log("Setting up storage...");
    const { data: bucketData, error: bucketError } = await supabase.storage.createBucket('agent-logos', {
        public: true,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/svg+xml'],
        fileSizeLimit: 1048576 // 1MB
    });

    if (bucketError) {
        if (bucketError.message.includes('already exists')) {
            console.log("Bucket 'agent-logos' already exists.");
        } else {
            console.error("Error creating bucket:", bucketError.message);
        }
    } else {
        console.log("Bucket 'agent-logos' created successfully.");
    }

    console.log("Verifying agents table by attempting a dry-run insert...");
    // We try to insert a record with all the columns we expect.
    // Since we don't have a real UUID for a user right now, we might get a FK error if 'id' must be auth.users.id
    // But it will tell us if columns are missing.
    const testAgent = {
        id: '00000000-0000-0000-0000-000000000000',
        company_name: 'Test Agency',
        agency_details: 'Test details',
        phone_number: '123456789',
        markup_percent: 15,
        logo_url: 'https://example.com/logo.png'
    };

    const { error: insertErr } = await supabase.from('agents').insert(testAgent);
    if (insertErr) {
        console.log("Insert result (expected fail or success):", insertErr.message);
        if (insertErr.message.includes('column') && insertErr.message.includes('does not exist')) {
            console.error("CRITICAL: Some columns are missing in 'agents' table!");
        }
    } else {
        console.log("Insert worked (or at least columns matched). Rolling back...");
        await supabase.from('agents').delete().eq('id', testAgent.id);
    }
}

setup();
