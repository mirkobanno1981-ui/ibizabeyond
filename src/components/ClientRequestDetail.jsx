import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getClientRequest, updateClientRequest } from '../lib/clientRequestApi';
import { matchVillas } from '../lib/clientRequestMatch';
import RequestQuoteModal from './RequestQuoteModal';

const FALLBACK_IMG = '/villa-placeholder.jpg';

export default function ClientRequestDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const [request, setRequest] = useState(null);
    const [matches, setMatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [matching, setMatching] = useState(false);
    const [error, setError] = useState(null);
    const [bulkCount, setBulkCount] = useState(3);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [quoteVilla, setQuoteVilla] = useState(null); // for RequestQuoteModal

    async function loadRequest() {
        setLoading(true);
        try {
            const row = await getClientRequest(id);
            if (!row) { setError('Richiesta non trovata'); return; }
            setRequest(row);
            await runMatch(row);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function runMatch(row) {
        if (!row?.parsed) return;
        setMatching(true);
        try {
            const res = await matchVillas(row.parsed, { limit: 12 });
            setMatches(res);
            if (res.length > 0 && row.status === 'parsed') {
                await updateClientRequest(row.id, { status: 'matched' });
                setRequest({ ...row, status: 'matched' });
            }
        } catch (err) {
            console.error('[ClientRequestDetail] match failed', err);
        } finally {
            setMatching(false);
        }
    }

    useEffect(() => { loadRequest(); }, [id]);

    async function createDraftFromMatch(match) {
        const p = request.parsed || {};
        const ins = {
            v_uuid: match.villa.v_uuid,
            client_id: null,
            request_id: request.id,
            check_in: p.check_in || null,
            check_out: p.check_out || null,
            supplier_base_price: match.totalEur,
            admin_markup: 0,
            agent_markup: 0,
            editor_markup: 0,
            final_price: match.totalEur,
            status: 'draft',
            agent_id: user?.id,
            price_breakdown: [{
                label: 'Base (AI match estimate)',
                amount: Math.round(match.totalEur),
                desc: p.check_in && p.check_out ? `${p.check_in} → ${p.check_out}` : 'No dates',
            }],
            group_details: {
                type: p.group_type || 'family',
                adults: p.guests_min || 2,
                children: 0,
                has_pets: p.has_pets || false,
            },
        };
        const { data, error } = await supabase.from('quotes').insert(ins).select('id').single();
        if (error) throw error;
        return data.id;
    }

    async function handleBulkDraft() {
        const N = Math.min(bulkCount, matches.length);
        if (N === 0) return;
        if (!confirm(`Creare ${N} draft quote per le top ${N} ville?`)) return;
        setBulkBusy(true);
        try {
            const ids = [];
            for (const m of matches.slice(0, N)) {
                const qid = await createDraftFromMatch(m);
                ids.push(qid);
            }
            await updateClientRequest(request.id, { status: 'quoted' });
            alert(`${ids.length} draft create. Aprile per assegnare il cliente.`);
            navigate('/quotes');
        } catch (err) {
            alert('Errore: ' + err.message);
        } finally {
            setBulkBusy(false);
        }
    }

    async function handleStatusChange(newStatus) {
        const updated = await updateClientRequest(request.id, { status: newStatus });
        setRequest(updated);
    }

    if (loading) return <div className="p-8 text-text-muted">Loading…</div>;
    if (error) return <div className="p-8 text-red-400">{error}</div>;
    if (!request) return null;

    const p = request.parsed || {};

    return (
        <div className="p-6 md:p-8 space-y-6">
            <div className="flex items-center justify-between gap-3">
                <Link to="/requests" className="text-xs font-bold text-text-muted hover:text-text-primary flex items-center gap-1">
                    <span className="material-symbols-outlined notranslate text-[16px]">arrow_back</span>
                    Tutte le richieste
                </Link>
                <select
                    value={request.status}
                    onChange={e => handleStatusChange(e.target.value)}
                    className="input-theme text-xs uppercase tracking-wider font-bold"
                >
                    <option value="new">Nuova</option>
                    <option value="parsed">Analizzata</option>
                    <option value="matched">Match trovati</option>
                    <option value="quoted">Quote inviate</option>
                    <option value="closed">Chiusa</option>
                </select>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Criteria column */}
                <div className="lg:col-span-1 space-y-4">
                    <div className="glass-card p-5 space-y-3">
                        <h2 className="text-lg font-bold text-text-primary">Criteri</h2>
                        <CriteriaRow icon="bed" label="Camere min">{p.bedrooms_min || '—'}</CriteriaRow>
                        <CriteriaRow icon="group" label="Ospiti min">{p.guests_min || '—'}</CriteriaRow>
                        <CriteriaRow icon="calendar_month" label="Date">
                            {p.check_in && p.check_out ? `${p.check_in} → ${p.check_out}` : '—'}
                        </CriteriaRow>
                        <CriteriaRow icon="euro" label="Budget">
                            {p.budget_total_eur ? `€${Number(p.budget_total_eur).toLocaleString()}` : '—'}
                            {p.budget_period && (
                                <span className="text-text-muted ml-1 text-[11px]">
                                    ({p.budget_value_eur}/{p.budget_period.replace('per_', '')})
                                </span>
                            )}
                        </CriteriaRow>
                        <CriteriaRow icon="home" label="Tipo">{p.property_type || 'any'}</CriteriaRow>
                        <CriteriaRow icon="location_on" label="Area">{p.area_preference || '—'}</CriteriaRow>
                        <CriteriaRow icon="groups" label="Gruppo">{p.group_type || '—'}{p.has_pets ? ' • con pet' : ''}</CriteriaRow>

                        {p.amenities?.length > 0 && (
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1">Amenities richieste</div>
                                <div className="flex flex-wrap gap-1">
                                    {p.amenities.map(a => (
                                        <span key={a} className="bg-primary/20 text-primary px-2 py-0.5 rounded-full text-[10px] font-bold">{a}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {p.amenities_freeform?.length > 0 && (
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-amber-400 font-bold mb-1">Extra non in catalogo</div>
                                <div className="flex flex-wrap gap-1">
                                    {p.amenities_freeform.map(a => (
                                        <span key={a} className="bg-amber-500/10 text-amber-300 px-2 py-0.5 rounded-full text-[10px]">{a}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {p.notes && (
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1">Note AI</div>
                                <p className="text-xs text-text-muted italic">{p.notes}</p>
                            </div>
                        )}
                    </div>

                    <details className="glass-card p-4">
                        <summary className="text-xs uppercase tracking-wider font-bold text-text-muted cursor-pointer">Testo originale</summary>
                        <pre className="mt-3 whitespace-pre-wrap text-xs text-text-primary font-mono">{request.raw_text}</pre>
                    </details>

                    {matches.length > 0 && (
                        <div className="glass-card p-4 space-y-3">
                            <h3 className="text-xs uppercase tracking-wider font-bold text-text-muted">Crea draft in bulk</h3>
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    min="1"
                                    max={matches.length}
                                    value={bulkCount}
                                    onChange={e => setBulkCount(Math.max(1, Math.min(matches.length, parseInt(e.target.value) || 1)))}
                                    className="input-theme w-16 text-sm"
                                />
                                <span className="text-xs text-text-muted">draft sui top {matches.length}</span>
                            </div>
                            <button
                                onClick={handleBulkDraft}
                                disabled={bulkBusy}
                                className="w-full btn-primary text-sm disabled:opacity-50"
                            >
                                {bulkBusy ? 'Creazione…' : `Crea ${bulkCount} draft`}
                            </button>
                            <p className="text-[10px] text-text-muted">
                                Draft senza cliente assegnato. Aprili in /quotes per assegnare il cliente e finalizzare il prezzo.
                            </p>
                        </div>
                    )}
                </div>

                {/* Matches column */}
                <div className="lg:col-span-2 space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-text-primary">
                            {matching ? 'Cerco match…' : `${matches.length} ville candidate`}
                        </h2>
                        <button
                            onClick={() => runMatch(request)}
                            disabled={matching}
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                            <span className="material-symbols-outlined notranslate text-[14px]">refresh</span>
                            Rilancia match
                        </button>
                    </div>

                    {matching && matches.length === 0 ? (
                        <div className="text-center py-12 text-text-muted">Ricerca in corso…</div>
                    ) : matches.length === 0 ? (
                        <div className="glass-card p-12 text-center">
                            <span className="material-symbols-outlined notranslate text-5xl text-text-muted mb-3 block">search_off</span>
                            <p className="text-text-muted text-sm">Nessuna villa corrisponde ai criteri. Allenta i filtri (camere, amenities) o controlla le date.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {matches.map(m => (
                                <MatchCard
                                    key={m.villa.v_uuid}
                                    match={m}
                                    onQuote={() => setQuoteVilla(m)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {quoteVilla && (
                <RequestQuoteModal
                    match={quoteVilla}
                    request={request}
                    onClose={() => setQuoteVilla(null)}
                    onCreated={async () => {
                        setQuoteVilla(null);
                        if (request.status !== 'quoted') {
                            await updateClientRequest(request.id, { status: 'quoted' });
                            setRequest({ ...request, status: 'quoted' });
                        }
                    }}
                />
            )}
        </div>
    );
}

function CriteriaRow({ icon, label, children }) {
    return (
        <div className="flex items-start gap-2 text-sm">
            <span className="material-symbols-outlined notranslate text-[16px] text-text-muted mt-0.5">{icon}</span>
            <div className="flex-1">
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
                <div className="text-text-primary">{children}</div>
            </div>
        </div>
    );
}

function MatchCard({ match, onQuote }) {
    const { villa, score, breakdown, totalEur, totalEurInBudget } = match;
    return (
        <div className="glass-card overflow-hidden flex flex-col group hover:border-primary/30 transition">
            <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
                <img
                    src={villa.thumbnail || FALLBACK_IMG}
                    alt={villa.villa_name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    onError={e => { e.currentTarget.src = FALLBACK_IMG; }}
                    loading="lazy"
                />
                <div className="absolute top-3 right-3 bg-background/90 backdrop-blur-md border border-border px-2 py-1 rounded-lg text-xs font-black"
                     title={`budget ${breakdown.budget.toFixed(0)} + amen ${breakdown.amenities.toFixed(0)} + bed ${breakdown.bedrooms} + area ${breakdown.area} + lic ${breakdown.licensed}`}>
                    <span className="text-primary">{score}</span><span className="text-text-muted">/100</span>
                </div>
                <div className="absolute bottom-3 left-3 bg-background/90 backdrop-blur-md border border-border px-3 py-1.5 rounded-xl">
                    <div className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-0.5">Totale soggiorno</div>
                    <div className="flex items-baseline gap-1">
                        <span className={`font-black text-base leading-none ${totalEurInBudget ? 'text-primary' : 'text-amber-400'}`}>
                            {totalEur > 0 ? `€${Math.round(totalEur).toLocaleString()}` : 'POA'}
                        </span>
                        {!totalEurInBudget && totalEur > 0 && (
                            <span className="text-amber-400 text-[10px] font-bold">over budget</span>
                        )}
                    </div>
                </div>
            </div>
            <div className="p-4 flex-1 flex flex-col gap-2">
                <h3 className="font-semibold text-sm text-text-primary truncate">{villa.villa_name || 'Unnamed'}</h3>
                <div className="flex items-center gap-1 text-text-muted text-xs">
                    <span className="material-symbols-outlined notranslate text-[12px]">location_on</span>
                    <span>{villa.areaname || villa.district || 'Ibiza'}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-text-muted">
                    <span className="flex items-center gap-1"><span className="material-symbols-outlined notranslate text-[14px]">bed</span>{villa.bedrooms || '—'}</span>
                    <span className="flex items-center gap-1"><span className="material-symbols-outlined notranslate text-[14px]">shower</span>{villa.bathrooms || '—'}</span>
                    <span className="flex items-center gap-1"><span className="material-symbols-outlined notranslate text-[14px]">group</span>{villa.sleeps || '—'}</span>
                </div>
                <div className="flex gap-2 mt-auto pt-2">
                    <Link
                        to={`/villas/${villa.v_uuid}`}
                        className="flex-1 text-center text-xs font-semibold py-2 rounded-lg bg-surface-2 hover:bg-surface text-text-muted hover:text-text-primary"
                    >Apri scheda</Link>
                    <button
                        onClick={onQuote}
                        className="flex-1 text-xs font-semibold py-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30"
                    >Crea quote</button>
                </div>
            </div>
        </div>
    );
}
