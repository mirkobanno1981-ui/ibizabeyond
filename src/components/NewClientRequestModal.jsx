import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { parseClientRequest, createClientRequest } from '../lib/clientRequestApi';

const EXAMPLE_PLACEHOLDER = `Villa lusso con Gym e Piscina
15/07 - 15/08
5 bed
35 k settimana`;

export default function NewClientRequestModal({ onClose, onCreated }) {
    const [phase, setPhase] = useState('paste'); // paste | parsing | review | saving
    const [rawText, setRawText] = useState('');
    const [confidence, setConfidence] = useState(null);
    const [parsed, setParsed] = useState(null);
    const [error, setError] = useState(null);
    const [amenityCatalog, setAmenityCatalog] = useState([]);

    useEffect(() => {
        (async () => {
            const { data } = await supabase
                .from('amenity_catalog')
                .select('label, category')
                .eq('is_active', true)
                .order('category')
                .order('label');
            setAmenityCatalog(data || []);
        })();
    }, []);

    const amenityByCategory = useMemo(() => {
        const out = {};
        for (const a of amenityCatalog) {
            if (!out[a.category]) out[a.category] = [];
            out[a.category].push(a.label);
        }
        return out;
    }, [amenityCatalog]);

    async function handleParse() {
        if (!rawText.trim()) return;
        setError(null);
        setPhase('parsing');
        try {
            const { parsed, confidence } = await parseClientRequest(rawText);
            setParsed({
                check_in: parsed.check_in || '',
                check_out: parsed.check_out || '',
                nights: parsed.nights || null,
                bedrooms_min: parsed.bedrooms_min || '',
                guests_min: parsed.guests_min || '',
                budget_value_eur: parsed.budget_value_eur || '',
                budget_period: parsed.budget_period || 'per_week',
                budget_total_eur: parsed.budget_total_eur || '',
                currency: parsed.currency || 'EUR',
                property_type: parsed.property_type || 'any',
                amenities: parsed.amenities || [],
                amenities_freeform: parsed.amenities_freeform || [],
                area_preference: parsed.area_preference || '',
                group_type: parsed.group_type || '',
                has_pets: parsed.has_pets ?? false,
                notes: parsed.notes || '',
            });
            setConfidence(confidence);
            setPhase('review');
        } catch (err) {
            setError(err.message || 'Parse failed');
            setPhase('paste');
        }
    }

    function patch(field, value) {
        setParsed(p => ({ ...p, [field]: value }));
    }

    function toggleAmenity(label) {
        setParsed(p => ({
            ...p,
            amenities: p.amenities.includes(label)
                ? p.amenities.filter(a => a !== label)
                : [...p.amenities, label],
        }));
    }

    const derivedBudgetTotal = useMemo(() => {
        if (!parsed) return 0;
        const v = parseFloat(parsed.budget_value_eur) || 0;
        if (!v) return 0;
        const nights = parsed.nights
            ? Number(parsed.nights)
            : (parsed.check_in && parsed.check_out
                ? Math.max(1, Math.round((new Date(parsed.check_out) - new Date(parsed.check_in)) / 86400000))
                : 7);
        if (parsed.budget_period === 'total') return Math.round(v);
        if (parsed.budget_period === 'per_night') return Math.round(v * nights);
        return Math.round(v * (nights / 7));
    }, [parsed]);

    async function handleSave() {
        if (!parsed) return;
        setPhase('saving');
        try {
            const finalParsed = {
                ...parsed,
                bedrooms_min: parsed.bedrooms_min ? parseInt(parsed.bedrooms_min) : null,
                guests_min: parsed.guests_min ? parseInt(parsed.guests_min) : null,
                budget_value_eur: parsed.budget_value_eur ? parseFloat(parsed.budget_value_eur) : null,
                budget_total_eur: derivedBudgetTotal || null,
                check_in: parsed.check_in || null,
                check_out: parsed.check_out || null,
                area_preference: parsed.area_preference || null,
                group_type: parsed.group_type || null,
                notes: parsed.notes || null,
            };
            const row = await createClientRequest({
                rawText,
                parsed: finalParsed,
                confidence,
            });
            onCreated?.(row);
        } catch (err) {
            setError(err.message || 'Save failed');
            setPhase('review');
        }
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div>
                        <h2 className="text-lg font-bold text-text-primary">Nuova richiesta cliente</h2>
                        <p className="text-xs text-text-muted">
                            {phase === 'paste' && 'Incolla il testo libero della richiesta'}
                            {phase === 'parsing' && 'Analisi AI in corso…'}
                            {phase === 'review' && 'Verifica e correggi i campi estratti'}
                            {phase === 'saving' && 'Salvataggio…'}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1">
                        <span className="material-symbols-outlined notranslate">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-lg px-3 py-2">
                            {error}
                        </div>
                    )}

                    {(phase === 'paste' || phase === 'parsing') && (
                        <>
                            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Testo richiesta</label>
                            <textarea
                                value={rawText}
                                onChange={e => setRawText(e.target.value)}
                                placeholder={EXAMPLE_PLACEHOLDER}
                                rows={10}
                                disabled={phase === 'parsing'}
                                className="input-theme w-full font-mono text-sm"
                                autoFocus
                            />
                            <p className="text-xs text-text-muted">
                                Es. date come <code>15/07 - 15/08</code>, budget come <code>35k settimana</code>, capacità come <code>5 bed</code>.
                            </p>
                        </>
                    )}

                    {phase === 'review' && parsed && (
                        <div className="space-y-4">
                            {confidence != null && (
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-text-muted uppercase tracking-wider font-semibold">Confidence AI:</span>
                                    <span className={`px-2 py-0.5 rounded-full font-bold ${
                                        confidence >= 0.75 ? 'bg-green-500/20 text-green-300'
                                        : confidence >= 0.5 ? 'bg-amber-500/20 text-amber-300'
                                        : 'bg-red-500/20 text-red-300'
                                    }`}>
                                        {(confidence * 100).toFixed(0)}%
                                    </span>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Check-in">
                                    <input type="date" value={parsed.check_in || ''} onChange={e => patch('check_in', e.target.value)} className="input-theme w-full" />
                                </Field>
                                <Field label="Check-out">
                                    <input type="date" value={parsed.check_out || ''} onChange={e => patch('check_out', e.target.value)} className="input-theme w-full" />
                                </Field>
                                <Field label="Camere min">
                                    <input type="number" min="0" value={parsed.bedrooms_min || ''} onChange={e => patch('bedrooms_min', e.target.value)} className="input-theme w-full" />
                                </Field>
                                <Field label="Ospiti min">
                                    <input type="number" min="0" value={parsed.guests_min || ''} onChange={e => patch('guests_min', e.target.value)} className="input-theme w-full" />
                                </Field>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <Field label="Budget">
                                    <input type="number" min="0" value={parsed.budget_value_eur || ''} onChange={e => patch('budget_value_eur', e.target.value)} className="input-theme w-full" />
                                </Field>
                                <Field label="Periodo">
                                    <select value={parsed.budget_period || 'per_week'} onChange={e => patch('budget_period', e.target.value)} className="input-theme w-full">
                                        <option value="per_night">Per notte</option>
                                        <option value="per_week">Per settimana</option>
                                        <option value="total">Totale</option>
                                    </select>
                                </Field>
                                <Field label="Stimato totale">
                                    <div className="input-theme w-full bg-surface-2 cursor-not-allowed">
                                        {derivedBudgetTotal ? `€${derivedBudgetTotal.toLocaleString()}` : '—'}
                                    </div>
                                </Field>
                            </div>

                            <Field label="Tipo">
                                <div className="flex flex-wrap gap-2">
                                    {['any', 'villa', 'apartment', 'finca'].map(t => (
                                        <button
                                            key={t}
                                            type="button"
                                            onClick={() => patch('property_type', t)}
                                            className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide border transition ${
                                                parsed.property_type === t
                                                    ? 'bg-primary text-background border-primary'
                                                    : 'bg-surface border-border text-text-muted hover:text-text-primary'
                                            }`}
                                        >{t}</button>
                                    ))}
                                </div>
                            </Field>

                            <Field label="Amenities">
                                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                    {Object.entries(amenityByCategory).map(([cat, labels]) => (
                                        <div key={cat}>
                                            <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1">{cat}</div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {labels.map(label => {
                                                    const on = parsed.amenities.includes(label);
                                                    return (
                                                        <button
                                                            key={label}
                                                            type="button"
                                                            onClick={() => toggleAmenity(label)}
                                                            className={`px-2 py-0.5 rounded-full text-[11px] border transition ${
                                                                on
                                                                    ? 'bg-primary text-background border-primary font-bold'
                                                                    : 'bg-surface-2 text-text-muted border-border hover:text-text-primary'
                                                            }`}
                                                        >{label}</button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {parsed.amenities_freeform?.length > 0 && (
                                    <div className="mt-2 text-xs text-amber-300">
                                        Extra non in catalogo: {parsed.amenities_freeform.join(', ')}
                                    </div>
                                )}
                            </Field>

                            <Field label="Area / zona preferita">
                                <input type="text" value={parsed.area_preference || ''} onChange={e => patch('area_preference', e.target.value)} className="input-theme w-full" placeholder="Es. Es Cubells, Cala Jondal" />
                            </Field>

                            <Field label="Note">
                                <textarea value={parsed.notes || ''} onChange={e => patch('notes', e.target.value)} rows={2} className="input-theme w-full" />
                            </Field>
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-surface/40">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text-primary">Annulla</button>
                    {phase === 'paste' && (
                        <button
                            onClick={handleParse}
                            disabled={!rawText.trim()}
                            className="btn-primary text-sm disabled:opacity-50"
                        >
                            <span className="material-symbols-outlined notranslate text-[16px] mr-1">auto_awesome</span>
                            Analizza
                        </button>
                    )}
                    {phase === 'parsing' && (
                        <button disabled className="btn-primary text-sm opacity-60">
                            <span className="animate-spin inline-block size-4 border-2 border-current border-t-transparent rounded-full mr-2"></span>
                            Analisi…
                        </button>
                    )}
                    {phase === 'review' && (
                        <>
                            <button
                                onClick={() => setPhase('paste')}
                                className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text-primary"
                            >← Modifica testo</button>
                            <button onClick={handleSave} className="btn-primary text-sm">Salva richiesta</button>
                        </>
                    )}
                    {phase === 'saving' && (
                        <button disabled className="btn-primary text-sm opacity-60">Salvataggio…</button>
                    )}
                </div>
            </div>
        </div>
    );
}

function Field({ label, children }) {
    return (
        <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">{label}</label>
            {children}
        </div>
    );
}
