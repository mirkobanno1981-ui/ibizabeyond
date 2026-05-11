// Boat pricing helpers shared across BoatsPage (list), BoatView (detail) and BoatQuoteModal.
// Same selection rule everywhere:
//   - per-day price = matching seasonal_prices row's amount, else boat.daily_price.
//   - "starting from" = min of seasonal amounts > 0, else daily_price (if > 0), else null.

function parseISO(s) {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(n => parseInt(n, 10));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
}

function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function getPriceForDate(boat, seasonalRates, dateStr) {
    const date = parseISO(dateStr);
    if (!date) return 0;
    const rate = (seasonalRates || []).find(r => {
        const start = parseISO(r.start_date);
        const end = parseISO(r.end_date);
        return start && end && date >= start && date <= end;
    });
    if (rate) return Math.round(parseFloat(rate.amount) || 0);
    return Math.round(parseFloat(boat?.daily_price) || 0);
}

export function getTotalForRange(boat, seasonalRates, checkIn, checkOut) {
    if (!checkIn) return 0;
    const start = parseISO(checkIn);
    const end = parseISO(checkOut || checkIn);
    if (!start || !end || end < start) return 0;
    const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
    let total = 0;
    const d = new Date(start);
    for (let i = 0; i < days; i++) {
        total += getPriceForDate(boat, seasonalRates, toISO(d));
        d.setDate(d.getDate() + 1);
    }
    return total;
}

// Lowest non-zero seasonal rate. Falls back to daily_price when no seasonal row qualifies.
// Returns null when nothing is priced > 0 (hide badge / exclude from search).
export function getStartingFromPrice(boat, seasonalRates) {
    const positives = (seasonalRates || [])
        .map(r => parseFloat(r.amount))
        .filter(n => Number.isFinite(n) && n > 0);
    if (positives.length > 0) return Math.round(Math.min(...positives));
    const daily = parseFloat(boat?.daily_price) || 0;
    return daily > 0 ? Math.round(daily) : null;
}

// True when the month has at least one day priced > 0 (seasonal coverage OR positive daily_price).
export function monthHasPricing(boat, seasonalRates, year, month0) {
    const daily = parseFloat(boat?.daily_price) || 0;
    if (daily > 0) return true;
    const monthStart = new Date(year, month0, 1);
    const monthEnd = new Date(year, month0 + 1, 0);
    return (seasonalRates || []).some(r => {
        const amt = parseFloat(r.amount);
        if (!(amt > 0)) return false;
        const s = parseISO(r.start_date);
        const e = parseISO(r.end_date);
        if (!s || !e) return false;
        return s <= monthEnd && e >= monthStart;
    });
}
