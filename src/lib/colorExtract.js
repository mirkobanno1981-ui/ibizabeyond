const QUANTIZE_BITS = 4;
const SAMPLE_DIM = 96;

const toHex = (n) => n.toString(16).padStart(2, '0');
const rgbToHex = (r, g, b) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

const relativeLuminance = (r, g, b) => {
    const channel = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const colorDistance = (a, b) => {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return dr * dr + dg * dg + db * db;
};

const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
});

export async function extractPalette(imageSrc, maxColors = 5) {
    const img = await loadImage(imageSrc);
    const scale = Math.min(1, SAMPLE_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    ctx.drawImage(img, 0, 0, w, h);

    let pixels;
    try {
        pixels = ctx.getImageData(0, 0, w, h).data;
    } catch (err) {
        throw new Error('Image not CORS-readable. Re-upload the logo to extract its colors.');
    }

    const shift = 8 - QUANTIZE_BITS;
    const buckets = new Map();

    for (let i = 0; i < pixels.length; i += 4) {
        const a = pixels[i + 3];
        if (a < 200) continue;
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max - min < 12 && max > 230) continue;
        if (max < 25) continue;

        const qr = r >> shift;
        const qg = g >> shift;
        const qb = b >> shift;
        const key = (qr << (QUANTIZE_BITS * 2)) | (qg << QUANTIZE_BITS) | qb;

        const bucket = buckets.get(key);
        if (bucket) {
            bucket.r += r;
            bucket.g += g;
            bucket.b += b;
            bucket.n += 1;
        } else {
            buckets.set(key, { r, g, b, n: 1 });
        }
    }

    if (buckets.size === 0) return [];

    const sorted = [...buckets.values()]
        .map(({ r, g, b, n }) => ({
            r: Math.round(r / n),
            g: Math.round(g / n),
            b: Math.round(b / n),
            n
        }))
        .sort((a, b) => b.n - a.n);

    const picked = [];
    const minDist = 50 * 50;
    for (const c of sorted) {
        if (picked.every((p) => colorDistance(p, c) > minDist)) {
            picked.push(c);
            if (picked.length >= maxColors) break;
        }
    }

    return picked.map(({ r, g, b }) => rgbToHex(r, g, b));
}

export function suggestPrimaryAccent(palette) {
    if (!palette || palette.length === 0) return { primary: null, accent: null };

    const withMeta = palette.map((hex) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const lum = relativeLuminance(r, g, b);
        const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
        return { hex, r, g, b, lum, sat };
    });

    const primary = [...withMeta].sort((a, b) => (b.sat + (1 - Math.abs(b.lum - 0.5))) - (a.sat + (1 - Math.abs(a.lum - 0.5))))[0];
    const accent = [...withMeta]
        .filter((c) => c.hex !== primary.hex)
        .sort((a, b) => colorDistance(b, primary) - colorDistance(a, primary))[0];

    return {
        primary: primary?.hex ?? null,
        accent: accent?.hex ?? primary?.hex ?? null
    };
}

export function readableTextColor(hex) {
    if (!hex) return '#0f1117';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return relativeLuminance(r, g, b) > 0.5 ? '#0f1117' : '#f8f9fa';
}
