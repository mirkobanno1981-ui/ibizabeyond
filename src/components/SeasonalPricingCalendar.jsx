import React, { useMemo, useState } from 'react';

function fmt(d) {
    return d.toISOString().slice(0, 10);
}

function parseISO(s) {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(n => parseInt(n, 10));
    return new Date(y, m - 1, d);
}

function rangeIntersects(rate, dStr) {
    return dStr >= rate.start_date && dStr <= rate.end_date;
}

function colorFor(rate) {
    const palette = ['#D4AF37', '#10b981', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];
    const idx = (rate.id || 0) % palette.length;
    return palette[idx];
}

export default function SeasonalPricingCalendar({ rates = [], onAddRate, onDeleteRate, monthsAhead = 12 }) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [selStart, setSelStart] = useState(null);
    const [selEnd, setSelEnd] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [dailyPrice, setDailyPrice] = useState('');
    const [minNights, setMinNights] = useState(7);
    const [checkInPolicy, setCheckInPolicy] = useState('Flexible check in days');

    const months = useMemo(() => {
        const arr = [];
        for (let i = 0; i < monthsAhead; i++) {
            arr.push(new Date(today.getFullYear(), today.getMonth() + i, 1));
        }
        return arr;
    }, [monthsAhead]);

    const handleDayClick = (dStr) => {
        if (!selStart || (selStart && selEnd)) {
            setSelStart(dStr);
            setSelEnd(null);
            setShowForm(false);
            return;
        }
        if (dStr < selStart) {
            setSelStart(dStr);
            return;
        }
        setSelEnd(dStr);
        setShowForm(true);
    };

    const clearSelection = () => {
        setSelStart(null);
        setSelEnd(null);
        setShowForm(false);
        setDailyPrice('');
    };

    const handleSave = async () => {
        if (!selStart || !selEnd || !dailyPrice) return;
        const daily = parseFloat(dailyPrice);
        if (Number.isNaN(daily) || daily <= 0) return;
        await onAddRate({
            start_date: selStart,
            end_date: selEnd,
            amount: daily,
            minimum_nights: parseInt(minNights, 10) || 7,
            allowed_checkin_days: checkInPolicy,
        });
        clearSelection();
    };

    const isInSelection = (dStr) => {
        if (!selStart) return false;
        const end = selEnd || selStart;
        return dStr >= selStart && dStr <= end;
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-widest text-text-muted font-bold">
                    Select a period on the calendar, then enter the nightly price.
                </p>
                {(selStart || selEnd) && (
                    <button type="button" onClick={clearSelection} className="text-[10px] text-text-muted hover:text-red-400 uppercase tracking-widest font-black">
                        Reset
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[480px] overflow-y-auto p-2 bg-surface-2/30 rounded-xl border border-border">
                {months.map((monthDate) => {
                    const monthName = monthDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
                    const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
                    const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getDay();
                    return (
                        <div key={monthName} className="bg-surface rounded-lg p-3 border border-border">
                            <h4 className="text-xs font-bold text-text-secondary mb-2 capitalize">{monthName}</h4>
                            <div className="grid grid-cols-7 gap-0.5 text-center">
                                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                                    <div key={i} className="text-[9px] text-text-muted font-bold">{d}</div>
                                ))}
                                {[...Array(firstDay)].map((_, i) => <div key={`e${i}`} />)}
                                {[...Array(daysInMonth)].map((_, i) => {
                                    const d = i + 1;
                                    const dStr = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                                    const dDate = parseISO(dStr);
                                    const isPast = dDate < today;
                                    const inSel = isInSelection(dStr);
                                    const matchedRate = rates.find(r => rangeIntersects(r, dStr));
                                    const bg = inSel ? '#D4AF37' : (matchedRate ? colorFor(matchedRate) + '40' : 'transparent');
                                    return (
                                        <button
                                            key={d}
                                            type="button"
                                            disabled={isPast}
                                            onClick={() => handleDayClick(dStr)}
                                            title={matchedRate ? `€${Math.round(matchedRate.amount)}/night` : ''}
                                            className={`aspect-square text-[10px] font-medium rounded transition-all ${isPast ? 'opacity-20 cursor-not-allowed' : 'hover:ring-1 hover:ring-primary cursor-pointer'} ${inSel ? 'text-black font-black' : 'text-text-primary'}`}
                                            style={{ backgroundColor: bg }}
                                        >
                                            {d}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {showForm && selStart && selEnd && (
                <div className="bg-primary/5 border border-primary/30 rounded-xl p-4 space-y-3 animate-in slide-in-from-top-2">
                    <div className="flex items-center gap-2 text-xs">
                        <span className="material-symbols-outlined notranslate text-primary text-[16px]">date_range</span>
                        <span className="font-bold text-text-primary">{selStart} → {selEnd}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className="block text-[9px] text-text-muted mb-1 uppercase tracking-widest font-black">€/night</label>
                            <input type="number" step="1" autoFocus className="input-theme w-full text-sm" value={dailyPrice} onChange={e => setDailyPrice(e.target.value)} placeholder="e.g. 350" />
                        </div>
                        <div>
                            <label className="block text-[9px] text-text-muted mb-1 uppercase tracking-widest font-black">Min nights</label>
                            <input type="number" className="input-theme w-full text-sm" value={minNights} onChange={e => setMinNights(e.target.value)} />
                        </div>
                        <div>
                            <label className="block text-[9px] text-text-muted mb-1 uppercase tracking-widest font-black">Check-in</label>
                            <select className="input-theme w-full text-sm" value={checkInPolicy} onChange={e => setCheckInPolicy(e.target.value)}>
                                <option value="Flexible check in days">Flexible</option>
                                <option value="Strictly Saturday-Saturday">Sat-Sat</option>
                            </select>
                        </div>
                    </div>
                    {dailyPrice && parseFloat(dailyPrice) > 0 && (
                        <p className="text-[10px] text-primary/80 font-mono">
                             ≈ €{(parseFloat(dailyPrice) * 7).toLocaleString()} / week
                        </p>
                    )}
                    <div className="flex gap-2">
                        <button type="button" onClick={handleSave} className="btn-primary text-xs px-4 py-2 flex items-center gap-1">
                            <span className="material-symbols-outlined notranslate text-[14px]">save</span>
                            Save Rate
                        </button>
                        <button type="button" onClick={clearSelection} className="px-4 py-2 text-xs font-black uppercase tracking-widest text-text-muted hover:text-text-primary">Cancel</button>
                    </div>
                </div>
            )}

            {rates.length > 0 && (
                <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                        <thead className="bg-surface-2 text-text-muted">
                            <tr>
                                <th className="text-left px-3 py-2 font-semibold">Period</th>
                                <th className="text-right px-3 py-2 font-semibold">€/night</th>
                                <th className="text-right px-3 py-2 font-semibold">€/week</th>
                                <th className="text-center px-3 py-2 font-semibold">Min</th>
                                <th className="text-center px-3 py-2 font-semibold">Check-in</th>
                                <th className="w-10"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rates.map(r => (
                                <tr key={r.id || `${r.start_date}-${r.end_date}`} className="border-t border-border">
                                    <td className="px-3 py-2 text-text-primary">
                                        <span className="inline-block size-2 rounded mr-1.5 align-middle" style={{ backgroundColor: colorFor(r) }} />
                                        {r.start_date} → {r.end_date}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-primary font-bold">€{Math.round(Number(r.amount)).toLocaleString()}</td>
                                    <td className="px-3 py-2 text-right font-mono text-text-muted">€{(Number(r.amount) * 7).toLocaleString()}</td>
                                    <td className="px-3 py-2 text-center">{r.minimum_nights}</td>
                                    <td className="px-3 py-2 text-center text-[10px] text-text-muted">{r.allowed_checkin_days}</td>
                                    <td className="px-3 py-2 text-right">
                                        <button type="button" onClick={() => onDeleteRate(r)} className="text-red-400 hover:text-red-300">
                                            <span className="material-symbols-outlined notranslate text-[14px]">delete</span>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
