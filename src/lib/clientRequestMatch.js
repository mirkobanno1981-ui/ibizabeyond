import { supabase } from './supabase';

// Compute supplier-side nightly total for a villa across [checkIn, checkOut).
// Mirrors the per-night logic in VillasTable.jsx so prices stay consistent with the inventory view.
// Falls back to villa.minimum_price / 7 per night when no seasonal row covers the day.
export function computeVillaTotal(villa, rates, checkIn, checkOut) {
    if (!checkIn || !checkOut) {
        return Math.round(parseFloat(villa.minimum_price || villa.maximum_price) || 0);
    }
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
        return 0;
    }
    const nights = Math.ceil((end - start) / 86400000);
    const villaRates = rates || [];
    let total = 0;
    for (let i = 0; i < nights; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const rate = villaRates.find(r => {
            const rs = new Date(r.start_date);
            const re = new Date(r.end_date);
            return d >= rs && d <= re;
        });
        total += rate
            ? parseFloat(rate.amount) || 0
            : (parseFloat(villa.minimum_price) || 0) / 7;
    }
    total += parseFloat(villa.cleaning_charge) || 0;
    return Math.round(total);
}

// Pure ranking: 0..100 score with subscore breakdown.
export function scoreVilla(villa, parsed, totalEur) {
    const breakdown = { budget: 0, amenities: 0, bedrooms: 0, area: 0, licensed: 0 };
    const budget = Number(parsed?.budget_total_eur) || 0;

    if (budget > 0 && totalEur > 0) {
        if (totalEur <= budget) breakdown.budget = 40;
        else {
            const over = (totalEur / budget) - 1; // e.g. 0.2 = 20% over
            breakdown.budget = Math.max(0, 40 - 40 * (over / 0.5));
        }
    } else if (!budget) {
        breakdown.budget = 25; // neutral if no budget given
    }

    const requested = Array.isArray(parsed?.amenities) ? parsed.amenities : [];
    if (requested.length > 0) {
        const villaFeats = new Set((villa.features || []).map(f => String(f)));
        const matched = requested.filter(a => villaFeats.has(a)).length;
        breakdown.amenities = 25 * (matched / requested.length);
    } else {
        breakdown.amenities = 12;
    }

    const wanted = Number(parsed?.bedrooms_min) || 0;
    const have = Number(villa.bedrooms) || 0;
    if (wanted > 0 && have >= wanted) {
        const excess = have - wanted;
        breakdown.bedrooms = excess === 0 ? 15 : excess === 1 ? 12 : excess === 2 ? 8 : 4;
    } else if (!wanted) {
        breakdown.bedrooms = 7;
    }

    const areaPref = String(parsed?.area_preference || '').toLowerCase().trim();
    if (areaPref) {
        const hay = `${villa.areaname || ''} ${villa.district || ''}`.toLowerCase();
        if (hay && hay.includes(areaPref)) breakdown.area = 10;
    } else {
        breakdown.area = 5;
    }

    if (villa.license) breakdown.licensed = 10;

    const score = Math.round(
        breakdown.budget + breakdown.amenities + breakdown.bedrooms + breakdown.area + breakdown.licensed
    );
    return { score, breakdown };
}

/**
 * Run structured + soft-rank match for a parsed client request.
 * Returns top results sorted by score.
 *
 * @param {object} parsed   The parsed criteria stored on client_requests.parsed
 * @param {object} opts     { limit?: number, budgetTolerance?: number }
 * @returns {Promise<Array<{ villa, score, breakdown, totalEur, totalEurInBudget }>>}
 */
export async function matchVillas(parsed, opts = {}) {
    const limit = opts.limit ?? 12;
    const budgetTolerance = opts.budgetTolerance ?? 0.10;

    let query = supabase
        .from('properties')
        .select('*')
        .eq('is_active', true);

    if (parsed?.bedrooms_min) query = query.gte('bedrooms', parseInt(parsed.bedrooms_min));
    if (parsed?.guests_min) query = query.gte('sleeps', parseInt(parsed.guests_min));
    // DB enum only has 'villa' | 'apartment'; treat 'finca'/'any' as no filter.
    if (parsed?.property_type === 'villa' || parsed?.property_type === 'apartment') {
        query = query.eq('property_type', parsed.property_type);
    }
    if (Array.isArray(parsed?.amenities) && parsed.amenities.length > 0) {
        query = query.filter('features', 'cs', JSON.stringify(parsed.amenities));
    }

    const { data: villas, error } = await query;
    if (error) throw error;
    if (!villas || villas.length === 0) return [];

    const villaUuids = villas.map(v => v.v_uuid);

    // Photos (thumbnail for cards)
    const { data: photoData } = await supabase
        .from('property_photos')
        .select('v_uuid, thumbnail_url')
        .in('v_uuid', villaUuids)
        .eq('sort_order', 0);
    const photoMap = {};
    (photoData || []).forEach(p => { if (p.v_uuid) photoMap[p.v_uuid] = p.thumbnail_url; });

    // Seasonal rates (whole stay window if dates given)
    const ratesMap = {};
    if (parsed?.check_in && parsed?.check_out) {
        const { data: rates } = await supabase
            .from('seasonal_prices')
            .select('*')
            .in('v_uuid', villaUuids)
            .lte('start_date', parsed.check_out)
            .gte('end_date', parsed.check_in);
        (rates || []).forEach(r => {
            if (!ratesMap[r.v_uuid]) ratesMap[r.v_uuid] = [];
            ratesMap[r.v_uuid].push(r);
        });
    }

    // Availability — drop villas with overlapping blocks
    let candidates = villas;
    if (parsed?.check_in && parsed?.check_out) {
        const { data: blocks } = await supabase
            .from('villa_blocked_dates')
            .select('v_uuid, start_date, end_date')
            .in('v_uuid', villaUuids);
        const blocksByVilla = {};
        (blocks || []).forEach(b => {
            if (!blocksByVilla[b.v_uuid]) blocksByVilla[b.v_uuid] = [];
            blocksByVilla[b.v_uuid].push(b);
        });
        candidates = candidates.filter(v => {
            const arr = blocksByVilla[v.v_uuid] || [];
            return !arr.some(b => b.start_date < parsed.check_out && b.end_date >= parsed.check_in);
        });
    }

    const budget = Number(parsed?.budget_total_eur) || 0;

    const scored = candidates.map(v => {
        const totalEur = computeVillaTotal(v, ratesMap[v.v_uuid], parsed?.check_in, parsed?.check_out);
        const { score, breakdown } = scoreVilla(v, parsed, totalEur);
        const totalEurInBudget = budget ? totalEur <= budget * (1 + budgetTolerance) : true;
        return {
            villa: { ...v, thumbnail: photoMap[v.v_uuid] || null },
            score,
            breakdown,
            totalEur,
            totalEurInBudget,
        };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
}
