// Resolve effective capturer (editor) commission for a property + rental type.
//
// Returns { mode, pct, amount, included }:
//   mode      'percent' | 'fixed'
//   pct       commission % (used when mode === 'percent')
//   amount    commission € (used when mode === 'fixed')
//   included  true: commission already inside listed price (deducted from owner)
//             false: commission added on top of price (added to client total)
//
// Per-rental-type override of `included` is honoured via
// rental_type_configs[type].commission_included_override.
//
// Legacy `editor_markup_percent` column is no longer read here. The
// 20260429100000_villa_capturer_commission migration backfills the new fields.
export function effectiveCapturerCommission(villa, rentalType) {
    if (!villa) return { mode: 'percent', pct: 0, amount: 0, included: false };

    const mode   = villa.capturer_commission_mode || 'percent';
    const pct    = Number(villa.capturer_commission_pct ?? 0) || 0;
    const amount = Number(villa.capturer_commission_amount ?? 0) || 0;

    const cfg = (villa.rental_type_configs && rentalType)
        ? (villa.rental_type_configs[rentalType] || {})
        : {};
    const override = cfg.commission_included_override;
    const included = override === true || override === false
        ? override
        : !!villa.capturer_commission_included;

    return { mode, pct, amount, included };
}

// Resolved € commission for a given base price.
export function capturerCommissionEuro(basePrice, spec) {
    if (!spec) return 0;
    const base = Number(basePrice) || 0;
    if (spec.mode === 'fixed') return Number(spec.amount) || 0;
    return base * (Number(spec.pct) || 0) / 100;
}
