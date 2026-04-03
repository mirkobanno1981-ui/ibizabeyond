const fs = require('fs');
const path = require('path');

const stepsBase = '/root/.gemini/antigravity/brain/fc89ec2a-6417-43a3-a0c2-098d9343fea6/.system_generated/steps';

const tableFiles = {
    'auth.users': '912/output.txt',
    'public.agents': '893/output.txt',
    'public.invenio_properties': '890/output.txt',
    'public.quotes': '896/output.txt',
    'public.invenio_seasonal_prices': '899/output.txt',
    'public.invenio_boats': '899/output.txt',
    'public.invenio_photos': '902/output.txt'
};

function extractJson(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/<untrusted-data-[^>]+>\n([\s\S]+?)\n<\/untrusted-data-/);
    if (!match) {
        // Try parsing the whole thing as JSON if it's just the JSON output
        try {
            const parsed = JSON.parse(content);
            if (parsed.result) {
                const subMatch = parsed.result.match(/<untrusted-data-[^>]+>\n([\s\S]+?)\n<\/untrusted-data-/);
                if (subMatch) return JSON.parse(subMatch[1]);
            }
            return [];
        } catch (e) {
            return [];
        }
    }
    return JSON.parse(match[1]);
}

function formatValue(val) {
    if (val === null) return 'NULL';
    if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
    if (Array.isArray(val)) return `'{"${val.join('","')}"}'`;
    if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
    return val;
}

let fullSql = '-- Data Restoration Script\nBEGIN;\n';

// Special handling for auth.users
console.log("Processing auth.users...");
const users = extractJson(path.join(stepsBase, tableFiles['auth.users']));
users.forEach(u => {
    const cols = Object.keys(u).join(', ');
    const vals = Object.values(u).map(formatValue).join(', ');
    fullSql += `INSERT INTO auth.users (${cols}, instance_id, aud, role, is_sso_user, confirmed_at) VALUES (${vals}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', false, NOW()) ON CONFLICT (id) DO NOTHING;\n`;
});

// Process public tables
const publicTables = ['public.agents', 'public.invenio_properties', 'public.quotes', 'public.invenio_seasonal_prices', 'public.invenio_boats', 'public.invenio_photos'];

publicTables.forEach(table => {
    console.log(`Processing ${table}...`);
    const data = extractJson(path.join(stepsBase, tableFiles[table]));
    const tableName = table.split('.')[1];
    data.forEach(row => {
        const cols = Object.keys(row).join(', ');
        const vals = Object.values(row).map(formatValue).join(', ');
        fullSql += `INSERT INTO public.${tableName} (${cols}) VALUES (${vals}) ON CONFLICT DO NOTHING;\n`;
    });
});

fullSql += 'COMMIT;';
fs.writeFileSync('/root/ibizabeyond/supabase/restore_data.sql', fullSql);
console.log("SQL generated at /root/ibizabeyond/supabase/restore_data.sql");
