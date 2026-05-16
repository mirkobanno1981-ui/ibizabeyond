import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, 'dist');
const INDEX_HTML = readFileSync(join(DIST, 'index.html'), 'utf8');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const PORT = process.env.PORT || 8080;

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80';

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

const supabaseHeaders = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

async function fetchQuoteMeta(firstId) {
    const select = 'v_uuid,boat_uuid,clients(full_name),properties(v_uuid,villa_name,thumbnail_url),boats(v_uuid,boat_name,photo_urls)';
    const url = `${SUPABASE_URL}/rest/v1/quotes?id=eq.${encodeURIComponent(firstId)}&select=${encodeURIComponent(select)}`;
    const res = await fetch(url, { headers: supabaseHeaders });
    if (!res.ok) return null;
    const arr = await res.json();
    return Array.isArray(arr) ? arr[0] : null;
}

async function fetchPrimaryPhoto(quote) {
    const vUuid = quote?.properties?.v_uuid || quote?.v_uuid;
    const boatUuid = quote?.boats?.v_uuid || quote?.boat_uuid;
    const filters = [];
    if (vUuid) filters.push(`v_uuid.eq.${vUuid}`);
    if (boatUuid) filters.push(`boat_uuid.eq.${boatUuid}`);
    if (!filters.length) return null;
    const orExpr = filters.join(',');
    const url = `${SUPABASE_URL}/rest/v1/property_photos?or=(${encodeURIComponent(orExpr)})&select=url,thumbnail_url&order=sort_order.asc&limit=1`;
    try {
        const res = await fetch(url, { headers: supabaseHeaders });
        if (!res.ok) return null;
        const arr = await res.json();
        const row = Array.isArray(arr) ? arr[0] : null;
        return row?.url || row?.thumbnail_url || null;
    } catch {
        return null;
    }
}

async function pickImage(quote) {
    const fromPhotos = await fetchPrimaryPhoto(quote);
    if (fromPhotos) return fromPhotos;
    const villa = quote?.properties;
    const boat = quote?.boats;
    if (villa?.thumbnail_url) return villa.thumbnail_url;
    if (boat?.photo_urls) {
        const first = boat.photo_urls.split(',').map((u) => u.trim()).filter((u) => u.length > 5)[0];
        if (first) return first;
    }
    return FALLBACK_IMG;
}

async function buildMeta(quote, isMulti, pageUrl) {
    const villa = quote?.properties;
    const boat = quote?.boats;
    const client = quote?.clients;
    const propertyName = villa?.villa_name || boat?.boat_name || 'Ibiza';
    const clientName = client?.full_name || '';

    const title = isMulti
        ? `Ibiza Luxury Proposals${clientName ? ' for ' + clientName : ''}`
        : `${propertyName}${clientName ? ' – proposal for ' + clientName : ''}`;

    const description = isMulti
        ? `Exclusive proposals prepared for your stay in Ibiza. Tap to view and vote your favourite.`
        : `Exclusive proposal at ${propertyName}${clientName ? ' for ' + clientName : ''}. Tap to view details and confirm.`;

    const image = await pickImage(quote);

    return `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Ibiza Beyond" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:url" content="${escapeHtml(pageUrl)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(image)}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtml(propertyName)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />`;
}

function injectMeta(metaHtml) {
    return INDEX_HTML
        .replace(/<title>[^<]*<\/title>\s*/i, '')
        .replace(/<meta\s+name="description"[^>]*>\s*/i, '')
        .replace('</head>', `${metaHtml}\n  </head>`);
}

const app = express();
app.set('trust proxy', true);

app.get('/quote/:id', async (req, res) => {
    try {
        const ids = String(req.params.id).split(',').filter(Boolean);
        const firstId = ids[0];
        const quote = firstId ? await fetchQuoteMeta(firstId) : null;
        const pageUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const html = injectMeta(await buildMeta(quote, ids.length > 1, pageUrl));
        res.set('Cache-Control', 'public, max-age=300');
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error('OG inject error:', err);
        res.sendFile(join(DIST, 'index.html'));
    }
});

app.use(express.static(DIST, { index: false }));

app.get('*', (_req, res) => res.sendFile(join(DIST, 'index.html')));

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
