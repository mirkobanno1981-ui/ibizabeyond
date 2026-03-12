import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// ATTENZIONE: Questo script richiede la SERVICE_ROLE_KEY di Supabase per funzionare.
// La trovi in Supabase Dashboard -> Settings -> API -> service_role (secret)

const env = fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .reduce((acc, line) => {
        const [key, value] = line.split('=');
        if (key && value) acc[key.trim()] = value.trim();
        return acc;
    }, {});

const SERVICE_ROLE_KEY = 'INSERISCI_QUI_LA_TUA_SERVICE_ROLE_KEY';

if (SERVICE_ROLE_KEY === 'INSERISCI_QUI_LA_TUA_SERVICE_ROLE_KEY') {
    console.error("ERRORE: Devi inserire la SERVICE_ROLE_KEY nello script.");
    process.exit(1);
}

const supabase = createClient(env.VITE_SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function resetPassword() {
    const email = 'admin@ibizabeyond.com';
    const newPassword = 'password123';

    console.log(`Tentativo di reset password per ${email}...`);

    // 1. Troviamo l'ID dell'utente
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
        console.error("Errore nel recupero utenti:", listError.message);
        return;
    }

    const user = users.find(u => u.email === email);
    if (!user) {
        console.error("Utente non trovato.");
        return;
    }

    // 2. Aggiorniamo la password direttamente bypassando il rate limit dell'email
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
        password: newPassword
    });

    if (updateError) {
        console.error("Errore durante l'aggiornamento:", updateError.message);
    } else {
        console.log("SUCCESSO! La password è stata impostata a: " + newPassword);
        console.log("Ora puoi accedere senza aspettare l'email.");
    }
}

resetPassword();
