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

async function fetchQuoteMeta(firstId) {
    const select = 'clients(full_name),invenio_properties(villa_name,images,thumbnail_url),invenio_boats(boat_name,photo_urls)';
    const url = `${SUPABASE_URL}/rest/v1/quotes?id=eq.${encodeURIComponent(firstId)}&select=${encodeURIComponent(select)}`;
    const res = await fetch(url, {
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
    });
    if (!res.ok) return null;
    const arr = await res.json();
    return Array.isArray(arr) ? arr[0] : null;
}

function pickImage(quote) {
    const villa = quote?.invenio_properties;
    const boat = quote?.invenio_boats;
    if (villa?.images?.length) return villa.images[0];
    if (villa?.thumbnail_url) return villa.thumbnail_url;
    if (boat?.photo_urls) {
        const first = boat.photo_urls.split(',').map((u) => u.trim()).filter((u) => u.length > 5)[0];
        if (first) return first;
    }
    return FALLBACK_IMG;
}

function buildMeta(quote, isMulti) {
    const villa = quote?.invenio_properties;
    const boat = quote?.invenio_boats;
    const client = quote?.clients;
    const propertyName = villa?.villa_name || boat?.boat_name || 'Ibiza';
    const clientName = client?.full_name || '';

    const title = isMulti
        ? `Ibiza Luxury Proposals${clientName ? ' for ' + clientName : ''}`
        : `${propertyName}${clientName ? ' – proposal for ' + clientName : ''}`;

    const description = isMulti
        ? `Exclusive proposals prepared for your stay in Ibiza. Vote your favourite.`
        : `Exclusive proposal at ${propertyName}${clientName ? ' for ' + clientName : ''}. Prepared by Ibiza Beyond.`;

    const image = pickImage(quote);

    return `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
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

app.get('/quote/:id', async (req, res) => {
    try {
        const ids = String(req.params.id).split(',').filter(Boolean);
        const firstId = ids[0];
        const quote = firstId ? await fetchQuoteMeta(firstId) : null;
        const html = injectMeta(buildMeta(quote, ids.length > 1));
        res.set('Cache-Control', 'public, max-age=60');
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
