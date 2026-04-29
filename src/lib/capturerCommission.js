// Resolve effective capturer (editor) commission for a villa + rental type.
// Replaces the legacy single editor_markup_percent number; falls back to it
// when the new fields are still 0 (migration safety net).
//
// Returns { mode, pct, amount, included }:
//   mode      'percent' | 'fixed'
//   pct       number (commission %)
//   amount    number (commission € when mode === 'fixed')
//   included  boolean — true: commission already inside listed price,
//                       false: commission added on top
export function effectiveCapturerCommission(villa, rentalType) {
    if (!villa) return { mode: 'percent', pct: 0, amount: 0, included: false };

    const mode   = villa.capturer_commission_mode || 'percent';
    const pct    = Number(
        villa.capturer_commission_pct ?? villa.editor_markup_percent ?? 0
    ) || 0;
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

// Compute the absolute € commission given a base price and the resolved spec.
export function capturerCommissionEuro(basePrice, spec) {
    if (!spec) return 0;
    const base = Number(basePrice) || 0;
    if (spec.mode === 'fixed') return spec.amount;
    return base * (spec.pct / 100);
}
