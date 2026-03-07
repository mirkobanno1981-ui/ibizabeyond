import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error("Mancano le variabili d'ambiente di Supabase nel file .env");
}

export const supabase = createClient(supabaseUrl, supabaseKey);
