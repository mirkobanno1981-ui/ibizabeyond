// Single source of truth for quote money math.
// Used by EditQuoteModal, VillaView, BoatView at save time.
// stripe-checkout reads the resolved € fields from the quote row — never recomputes.
//
// Formula (additive, deterministic):
//   1. editorShare       = supplierBase * editorPct / 100    (or fixed amount)
//   2. priceForMargin    = supplierBase + (editorIncluded ? 0 : editorShare)
//   3. agencyMargin      = priceForMargin * agentPct / 100
//   4. platformMargin    = priceForMargin * platformPct / 100
//   5. extrasTotal       = sum(extras[].price)
//   6. editorIvaBase     = editorIncluded ? 0 : editorShare
//   7. agencyIvaBase     = agencyMargin + extrasTotal
//   8. platformIvaBase   = platformMargin
//   9. editorIva, agencyIva, platformIva = each base * ivaPct / 100
//  10. ivaAmount         = sum of the three IVA amounts
//  11. preIvaSubtotal    = priceForMargin + agencyMargin + platformMargin + extras
//  12. preFeesTotal      = preIvaSubtotal + ivaAmount
//  13. stripeFee         = preFeesTotal * 0.03                              (always baked)
//  14. finalPrice        = preFeesTotal + stripeFee
//
// upfrontStay = supplierBase if last-minute (<=42d to check-in) else supplierBase * 0.5
//
// editorIncluded semantics:
//   true  → commission already inside supplierBase; deducted from owner payout.
//   false → commission added on top; client price grows by editorShare.
//
// Per-recipient IVA: editor, agency, platform each invoice IVA on their own
// commission. Owner side (supplierBase) carries no IVA — owner is the supplier
// receiving the rental net.

import { effectiveCapturerCommission } from './capturerCommission.js';

const STRIPE_FEE_PCT = 3;
const LAST_MINUTE_DAYS = 42;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => Number(n) || 0;

export function isLastMinute(checkInDate, today = new Date()) {
    if (!checkInDate) return false;
    const ci = new Date(checkInDate);
    ci.setUTCHours(0, 0, 0, 0);
    const t = new Date(today);
    t.setUTCHours(0, 0, 0, 0);
    const diff = Math.round((ci.getTime() - t.getTime()) / 86400000);
    return diff <= LAST_MINUTE_DAYS;
}

// Resolve editor (capturer) commission for a property. Boats use editor_commission_pct.
// Returns { share: €, included: bool }.
export function resolveEditorShare({ asset, assetType, rentalType, supplierBase, quoteOverridePct }) {
    const base = num(supplierBase);

    if (assetType === 'boat') {
        const pct = num(asset?.editor_commission_pct);
        return {
            share: round2(base * pct / 100),
            included: asset?.editor_commission_included !== false,
        };
    }

    // Villa / property — quote-level % override always wins.
    if (quoteOverridePct != null && quoteOverridePct !== '') {
        return {
            share: round2(base * num(quoteOverridePct) / 100),
            included: !!asset?.capturer_commission_included,
        };
    }

    const spec = effectiveCapturerCommission(asset, rentalType);
    const share = spec.mode === 'fixed' ? num(spec.amount) : base * num(spec.pct) / 100;
    return { share: round2(share), included: !!spec.included };
}

// Pure math. All inputs in €/percent. Returns the full snapshot as numbers.
export function computeBreakdown({
    supplierBase,
    agentPct,
    platformPct,
    editorShare,
    editorIncluded,
    extras = [],
    ivaPct,
    checkIn,
    isManual = false,
    manualPrice = null,
}) {
    const base = round2(supplierBase);
    const agentP = num(agentPct);
    const platformP = num(platformPct);
    const editor = round2(editorShare);
    const extrasTotal = round2(extras.reduce((s, e) => s + num(e?.price), 0));
    const iva = num(ivaPct);

    const priceForMargin = editorIncluded ? base : base + editor;
    const agencyMargin = round2(priceForMargin * agentP / 100);
    const platformMargin = round2(priceForMargin * platformP / 100);

    let agencyOut, platformOut;
    let preIvaSubtotal, preFeesTotal, stripeFee, finalPrice;

    if (isManual && manualPrice != null) {
        // Manual override: derive breakdown backwards from final price.
        finalPrice = round2(manualPrice);
        preFeesTotal = round2(finalPrice / (1 + STRIPE_FEE_PCT / 100));
        stripeFee = round2(finalPrice - preFeesTotal);
        // preFeesTotal = base + (commNet + extras) * (1 + iva/100)
        //   commNet = (editor if not included) + agencyOut + platformOut
        const ivaBearingNet = (preFeesTotal - base) / (1 + iva / 100);
        const editorNet = editorIncluded ? 0 : editor;
        const totalProfitNet = round2(ivaBearingNet - extrasTotal - editorNet);
        const totalPct = agentP + platformP;
        if (totalPct > 0) {
            agencyOut = round2(totalProfitNet * agentP / totalPct);
            platformOut = round2(totalProfitNet - agencyOut);
        } else {
            agencyOut = round2(totalProfitNet * 0.67);
            platformOut = round2(totalProfitNet - agencyOut);
        }
        preIvaSubtotal = round2(base + editorNet + agencyOut + platformOut + extrasTotal);
    } else {
        agencyOut = agencyMargin;
        platformOut = platformMargin;
        preIvaSubtotal = round2(priceForMargin + agencyMargin + platformMargin + extrasTotal);
    }

    // Per-recipient IVA: each commission carries its own IVA portion.
    // Owner side (supplierBase) carries no IVA — owner is the rental supplier.
    const editorIvaBase = editorIncluded ? 0 : editor;
    const agencyIvaBase = round2(agencyOut + extrasTotal);
    const platformIvaBase = round2(platformOut);

    const editorIva = round2(editorIvaBase * iva / 100);
    const agencyIva = round2(agencyIvaBase * iva / 100);
    const platformIva = round2(platformIvaBase * iva / 100);
    const ivaAmount = round2(editorIva + agencyIva + platformIva);

    if (!(isManual && manualPrice != null)) {
        preFeesTotal = round2(preIvaSubtotal + ivaAmount);
        stripeFee = round2(preFeesTotal * STRIPE_FEE_PCT / 100);
        finalPrice = round2(preFeesTotal + stripeFee);
    }

    const upfrontStay = isLastMinute(checkIn) ? base : round2(base * 0.5);

    return {
        // snapshot fields → quotes table columns
        supplier_base_price: base,
        editor_share_eur: editor,
        editor_included: !!editorIncluded,
        extras_total_eur: extrasTotal,
        agency_profit_eur: agencyOut,
        platform_profit_eur: platformOut,
        editor_iva_eur: editorIva,
        agency_iva_eur: agencyIva,
        platform_iva_eur: platformIva,
        iva_amount_eur: ivaAmount,
        iva_percent: iva,
        stripe_fee_eur: stripeFee,
        upfront_stay_eur: upfrontStay,
        final_price: finalPrice,
        _intermediate: {
            priceForMargin: round2(priceForMargin),
            preIvaSubtotal,
            preFeesTotal,
        },
    };
}

// Convert a snapshot to the legacy `price_breakdown` JSON used by the UI cards.
// IVA is shown per recipient (editor / agency / platform) so each line item
// reflects what that party invoices the client.
export function snapshotToBreakdownItems(snapshot, label = 'Base Accommodation') {
    const ivaPct = snapshot.iva_percent;
    const items = [
        { label, amount: snapshot.supplier_base_price, desc: 'Supplier cost (no IVA)' },
    ];
    if (!snapshot.editor_included && snapshot.editor_share_eur > 0) {
        items.push({
            label: `Editor (Captatore) commission`,
            amount: snapshot.editor_share_eur,
            desc: 'Capturer commission added to client price',
        });
        if (snapshot.editor_iva_eur > 0) {
            items.push({ label: `Editor IVA ${ivaPct}%`, amount: snapshot.editor_iva_eur, desc: 'VAT on editor commission' });
        }
    } else if (snapshot.editor_included && snapshot.editor_share_eur > 0) {
        items.push({
            label: `Editor (deduct from owner)`,
            amount: snapshot.editor_share_eur,
            desc: 'Capturer commission deducted from owner payout (no IVA — internal split)',
        });
    }
    if (snapshot.agency_profit_eur > 0) {
        items.push({ label: 'Agency Profit', amount: snapshot.agency_profit_eur, desc: 'Selling agency commission' });
    }
    if (snapshot.extras_total_eur > 0) {
        items.push({ label: 'Extra Services', amount: snapshot.extras_total_eur, desc: 'Additional services (invoiced by agency)' });
    }
    if (snapshot.agency_iva_eur > 0) {
        items.push({ label: `Agency IVA ${ivaPct}%`, amount: snapshot.agency_iva_eur, desc: 'VAT on agency commission + extras' });
    }
    if (snapshot.platform_profit_eur > 0) {
        items.push({ label: 'Platform Profit', amount: snapshot.platform_profit_eur, desc: 'Platform service fee' });
    }
    if (snapshot.platform_iva_eur > 0) {
        items.push({ label: `Platform IVA ${ivaPct}%`, amount: snapshot.platform_iva_eur, desc: 'VAT on platform commission' });
    }
    if (snapshot.stripe_fee_eur > 0) {
        items.push({ label: 'Stripe / Card Fee (3%)', amount: snapshot.stripe_fee_eur, desc: 'Digital payment processing cost' });
    }
    return items.map((i) => ({ ...i, amount: Math.round(i.amount) }));
}
