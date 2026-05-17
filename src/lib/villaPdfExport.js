import jsPDF from 'jspdf';
import { supabase } from './supabase';

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 15;

const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULT_PRIMARY = '#0f172a';
const DEFAULT_ACCENT = '#b48b4a';

function hexToRgb(hex) {
    const m = HEX.test(hex || '') ? hex : DEFAULT_PRIMARY;
    return [parseInt(m.slice(1, 3), 16), parseInt(m.slice(3, 5), 16), parseInt(m.slice(5, 7), 16)];
}

async function urlToDataUrl(url) {
    if (!url) return null;
    try {
        const res = await fetch(url, { mode: 'cors' });
        const blob = await res.blob();
        return await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onloadend = () => resolve(r.result);
            r.onerror = reject;
            r.readAsDataURL(blob);
        });
    } catch {
        return await new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.width;
                c.height = img.height;
                c.getContext('2d').drawImage(img, 0, 0);
                try { resolve(c.toDataURL('image/jpeg', 0.85)); } catch { resolve(null); }
            };
            img.onerror = () => resolve(null);
            img.src = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
        });
    }
}

function getImageDims(dataUrl) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve({ w: img.width, h: img.height });
        img.onerror = () => resolve({ w: 1, h: 1 });
        img.src = dataUrl;
    });
}

async function cropToCover(dataUrl, dims, targetW, targetH) {
    const targetRatio = targetW / targetH;
    const srcRatio = dims.w / dims.h;
    let sw = dims.w, sh = dims.h, sx = 0, sy = 0;
    if (srcRatio > targetRatio) {
        sw = dims.h * targetRatio;
        sx = (dims.w - sw) / 2;
    } else {
        sh = dims.w / targetRatio;
        sy = (dims.h - sh) / 2;
    }
    const maxPx = 1600;
    const scale = Math.min(1, maxPx / Math.max(sw, sh));
    const cw = Math.round(sw * scale);
    const ch = Math.round(sh * scale);
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = cw;
            c.height = ch;
            c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
            try { resolve(c.toDataURL('image/jpeg', 0.85)); } catch { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}

async function drawCover(doc, dataUrl, dims, x, y, w, h) {
    if (!dataUrl) {
        doc.setFillColor(226, 232, 240);
        doc.rect(x, y, w, h, 'F');
        return;
    }
    const cropped = await cropToCover(dataUrl, dims, w, h);
    if (!cropped) {
        doc.setFillColor(226, 232, 240);
        doc.rect(x, y, w, h, 'F');
        return;
    }
    try {
        doc.addImage(cropped, 'JPEG', x, y, w, h, undefined, 'FAST');
    } catch {
        doc.setFillColor(226, 232, 240);
        doc.rect(x, y, w, h, 'F');
    }
}

async function loadAgentBranding(agentId) {
    if (!agentId) return null;
    const { data, error } = await supabase
        .from('agents')
        .select('id, company_name, logo_url, phone_number, agency_details, brand_primary_color, brand_accent_color, email')
        .eq('id', agentId)
        .maybeSingle();
    if (error) console.warn('[villaPdfExport] agent branding fetch error:', error);
    return data;
}

async function loadOwnerBrandingForVilla(villa) {
    const ownerId = villa?.owner_id;
    if (!ownerId) return null;
    let { data, error } = await supabase
        .from('owners')
        .select('id, name, company_name, logo_url, phone_number, email')
        .eq('id', ownerId)
        .maybeSingle();
    if (error) console.warn('[villaPdfExport] owner branding fetch error:', error);
    if (!data) return null;
    return {
        company_name: data.company_name || data.name,
        logo_url: data.logo_url,
        phone_number: data.phone_number,
        email: data.email,
    };
}

async function loadVillaPhotos(vUuid) {
    const { data } = await supabase
        .from('property_photos')
        .select('url, thumbnail_url, sort_order, room_type')
        .eq('v_uuid', vUuid)
        .order('sort_order', { ascending: true });
    return data || [];
}

function drawTextBlock(doc, text, x, y, maxWidth, lineHeight = 5) {
    if (!text) return y;
    const lines = doc.splitTextToSize(String(text), maxWidth);
    doc.text(lines, x, y);
    return y + lines.length * lineHeight;
}

function checkPageBreak(doc, y, needed, footerFn) {
    if (y + needed > PAGE_H - 25) {
        if (footerFn) footerFn(doc);
        doc.addPage();
        return 25;
    }
    return y;
}

export async function exportVillaPdf({ villa, agentId, agentBranding: agentBrandingArg, fileName }) {
    if (!villa) throw new Error('villa required');
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });

    const [fetchedAgent, ownerBranding, photos] = await Promise.all([
        agentBrandingArg ? Promise.resolve(null) : loadAgentBranding(agentId),
        loadOwnerBrandingForVilla(villa),
        villa.v_uuid ? loadVillaPhotos(villa.v_uuid) : Promise.resolve([]),
    ]);

    const agentBranding = agentBrandingArg || fetchedAgent;
    // Merge: agent brand colors/logo win; fall back to owner contact when agent missing.
    const branding = {
        company_name: agentBranding?.company_name || ownerBranding?.company_name || 'Luxury Villa Collection',
        logo_url: agentBranding?.logo_url || ownerBranding?.logo_url,
        phone_number: agentBranding?.phone_number || ownerBranding?.phone_number,
        email: agentBranding?.email || ownerBranding?.email,
        agency_details: agentBranding?.agency_details,
        brand_primary_color: agentBranding?.brand_primary_color,
        brand_accent_color: agentBranding?.brand_accent_color,
    };

    console.log('[villaPdfExport] branding:', {
        company: branding.company_name,
        primary: branding.brand_primary_color,
        accent: branding.brand_accent_color,
        logo: !!branding.logo_url,
        photosCount: photos.length,
    });

    const primary = hexToRgb(branding.brand_primary_color);
    const accent = hexToRgb(branding.brand_accent_color || DEFAULT_ACCENT);

    const photoUrls = photos.map(p => p.url || p.thumbnail_url).filter(Boolean);
    if (!photoUrls.length && villa.thumbnail_url) photoUrls.push(villa.thumbnail_url);
    console.log('[villaPdfExport] photo urls:', photoUrls.length, photoUrls.slice(0, 2));

    const photoData = await Promise.all(photoUrls.slice(0, 9).map(async u => {
        const d = await urlToDataUrl(u);
        if (!d) { console.warn('[villaPdfExport] photo load failed:', u); return null; }
        const dims = await getImageDims(d);
        return { dataUrl: d, dims };
    }));
    const validPhotos = photoData.filter(Boolean);
    console.log('[villaPdfExport] valid photos loaded:', validPhotos.length);

    const logoData = branding?.logo_url ? await urlToDataUrl(branding.logo_url) : null;

    const drawFooter = (d) => {
        d.setFillColor(...primary);
        d.rect(0, PAGE_H - 18, PAGE_W, 18, 'F');
        d.setTextColor(255, 255, 255);
        d.setFontSize(8);
        d.setFont('helvetica', 'bold');
        const company = (branding?.company_name || 'Luxury Villa Collection').toUpperCase();
        d.text(company, MARGIN, PAGE_H - 10);
        d.setFont('helvetica', 'normal');
        d.setFontSize(7);
        d.setTextColor(200, 200, 200);
        const contact = [branding?.email, branding?.phone_number].filter(Boolean).join('  •  ');
        if (contact) d.text(contact, MARGIN, PAGE_H - 5);
        d.setTextColor(...accent);
        d.setFontSize(7);
        d.text(`${d.internal.getCurrentPageInfo().pageNumber}`, PAGE_W - MARGIN, PAGE_H - 7, { align: 'right' });
    };

    // ---------- PAGE 1: COVER ----------
    if (validPhotos[0]) {
        await drawCover(doc, validPhotos[0].dataUrl, validPhotos[0].dims, 0, 0, PAGE_W, 200);
    } else {
        doc.setFillColor(...primary);
        doc.rect(0, 0, PAGE_W, 200, 'F');
    }

    doc.setFillColor(0, 0, 0);
    doc.setGState(new doc.GState({ opacity: 0.35 }));
    doc.rect(0, 130, PAGE_W, 70, 'F');
    doc.setGState(new doc.GState({ opacity: 1 }));

    if (logoData) {
        try { doc.addImage(logoData, 'PNG', MARGIN, 15, 32, 16, undefined, 'FAST'); } catch {}
    } else {
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text((branding?.company_name || 'LUXURY').toUpperCase(), MARGIN, 25);
    }

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(32);
    const title = (villa.villa_name || 'Property').toUpperCase();
    const titleLines = doc.splitTextToSize(title, PAGE_W - MARGIN * 2);
    doc.text(titleLines, MARGIN, 160);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...accent);
    const location = [villa.areaname, villa.district, villa.destination].filter(Boolean).join(' · ').toUpperCase();
    if (location) doc.text(location, MARGIN, 175);

    if (villa.tagline) {
        doc.setTextColor(230, 230, 230);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'italic');
        const tagLines = doc.splitTextToSize(villa.tagline, PAGE_W - MARGIN * 2);
        doc.text(tagLines, MARGIN, 185);
    }

    // Quick specs strip below hero
    doc.setFillColor(...primary);
    doc.rect(0, 200, PAGE_W, 30, 'F');
    doc.setTextColor(255, 255, 255);
    const specs = [
        { label: 'BEDROOMS', value: villa.bedrooms ?? '—' },
        { label: 'BATHROOMS', value: villa.bathrooms ?? '—' },
        { label: 'GUESTS', value: villa.sleeps ?? '—' },
        { label: 'TYPE', value: (villa.property_type || 'villa').toUpperCase() },
    ];
    const colW = PAGE_W / specs.length;
    specs.forEach((s, i) => {
        const cx = colW * i + colW / 2;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text(String(s.value), cx, 215, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...accent);
        doc.text(s.label, cx, 222, { align: 'center' });
        doc.setTextColor(255, 255, 255);
    });

    // Description teaser on cover
    if (villa.description) {
        doc.setTextColor(60, 60, 60);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const teaser = String(villa.description).slice(0, 380);
        const lines = doc.splitTextToSize(teaser + (villa.description.length > 380 ? '…' : ''), PAGE_W - MARGIN * 2);
        doc.text(lines, MARGIN, 245);
    }
    drawFooter(doc);

    // ---------- PAGE 2: GALLERY ----------
    const gallery = validPhotos.slice(1, 7);
    if (gallery.length) {
        doc.addPage();
        doc.setFillColor(...primary);
        doc.rect(0, 0, PAGE_W, 18, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('GALLERY', MARGIN, 12);

        const gridX = MARGIN;
        const gridY = 28;
        const gap = 4;
        const cols = 2;
        const cellW = (PAGE_W - MARGIN * 2 - gap * (cols - 1)) / cols;
        const cellH = 75;
        for (let i = 0; i < gallery.length; i++) {
            const p = gallery[i];
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = gridX + col * (cellW + gap);
            const yy = gridY + row * (cellH + gap);
            await drawCover(doc, p.dataUrl, p.dims, x, yy, cellW, cellH);
        }
        drawFooter(doc);
    }

    // ---------- PAGE 3: DESCRIPTION + FEATURES ----------
    doc.addPage();
    doc.setFillColor(...primary);
    doc.rect(0, 0, PAGE_W, 18, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('THE PROPERTY', MARGIN, 12);

    let y = 30;
    doc.setTextColor(...primary);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(villa.villa_name || 'Property', MARGIN, y);
    y += 6;
    if (location) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...accent);
        doc.text(location, MARGIN, y);
        y += 8;
    }

    if (villa.description) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(60, 60, 60);
        const descLines = doc.splitTextToSize(String(villa.description), PAGE_W - MARGIN * 2);
        for (const line of descLines) {
            y = checkPageBreak(doc, y, 6, drawFooter);
            if (y === 25) {
                doc.setFillColor(...primary);
                doc.rect(0, 0, PAGE_W, 18, 'F');
                doc.setTextColor(255, 255, 255);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                doc.text('THE PROPERTY', MARGIN, 12);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(10);
                doc.setTextColor(60, 60, 60);
                y = 30;
            }
            doc.text(line, MARGIN, y);
            y += 5;
        }
        y += 6;
    }

    // Features
    const features = Array.isArray(villa.features) ? villa.features.filter(Boolean) : [];
    if (features.length) {
        y = checkPageBreak(doc, y, 30, drawFooter);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(...primary);
        doc.text('Features & Amenities', MARGIN, y);
        y += 7;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const cols = 2;
        const colWidth = (PAGE_W - MARGIN * 2) / cols;
        let col = 0;
        features.forEach(f => {
            if (col === 0) y = checkPageBreak(doc, y, 6, drawFooter);
            const fx = MARGIN + col * colWidth;
            doc.setTextColor(...accent);
            doc.text('•', fx, y);
            doc.setTextColor(60, 60, 60);
            doc.text(doc.splitTextToSize(String(f), colWidth - 6)[0] || '', fx + 4, y);
            col++;
            if (col >= cols) { col = 0; y += 5.5; }
        });
        if (col !== 0) y += 5.5;
        y += 8;
    }

    // Stay info
    const stayInfo = [];
    if (villa.minimum_nights) stayInfo.push(['Minimum stay', `${villa.minimum_nights} nights`]);
    if (villa.allowed_checkin_days) stayInfo.push(['Check-in policy', villa.allowed_checkin_days]);
    if (villa.allow_shortstays === 'yes' || villa.allow_shortstays === '1') stayInfo.push(['Short stays', 'Available']);

    if (stayInfo.length) {
        y = checkPageBreak(doc, y, 30, drawFooter);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(...primary);
        doc.text('Stay Information', MARGIN, y);
        y += 7;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        stayInfo.forEach(([k, v]) => {
            y = checkPageBreak(doc, y, 6, drawFooter);
            doc.setTextColor(...accent);
            doc.text(k, MARGIN, y);
            doc.setTextColor(60, 60, 60);
            doc.text(String(v), MARGIN + 50, y);
            y += 5.5;
        });
    }

    drawFooter(doc);

    // ---------- PAGE 4: CONTACT (only if branding) ----------
    if (branding && (branding.company_name || branding.phone_number || branding.email)) {
        doc.addPage();
        doc.setFillColor(...primary);
        doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

        if (logoData) {
            try { doc.addImage(logoData, 'PNG', PAGE_W / 2 - 25, 60, 50, 25, undefined, 'FAST'); } catch {}
        }
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        doc.text((branding.company_name || '').toUpperCase(), PAGE_W / 2, 105, { align: 'center' });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(...accent);
        doc.text('GET IN TOUCH', PAGE_W / 2, 130, { align: 'center' });

        doc.setTextColor(230, 230, 230);
        doc.setFontSize(11);
        let cy = 145;
        if (branding.email) { doc.text(branding.email, PAGE_W / 2, cy, { align: 'center' }); cy += 7; }
        if (branding.phone_number) { doc.text(branding.phone_number, PAGE_W / 2, cy, { align: 'center' }); cy += 7; }
        if (branding.agency_details) {
            doc.setFontSize(9);
            const lines = doc.splitTextToSize(branding.agency_details, 120);
            doc.text(lines, PAGE_W / 2, cy + 4, { align: 'center' });
        }

        doc.setTextColor(...accent);
        doc.setFontSize(8);
        doc.text((villa.villa_name || '').toUpperCase(), PAGE_W / 2, PAGE_H - 15, { align: 'center' });
    }

    const safeName = (villa.villa_name || 'villa').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    doc.save(fileName || `${safeName}_brochure.pdf`);
}
