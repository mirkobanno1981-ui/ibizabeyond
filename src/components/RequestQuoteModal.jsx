import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// Thin wrapper: pick a client + tweak margins, then insert one draft quote
// linked to the originating request. Authoritative price math runs in
// EditQuoteModal when the agent opens the quote later.
export default function RequestQuoteModal({ match, request, onClose, onCreated }) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [clients, setClients] = useState([]);
    const [selectedClientId, setSelectedClientId] = useState('');
    const [platformMargin, setPlatformMargin] = useState(0);
    const [agentMargin, setAgentMargin] = useState(15);
    const [ivaPercent, setIvaPercent] = useState(21);
    const [askOwnerPrice, setAskOwnerPrice] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        (async () => {
            const [{ data: cs }, { data: ms }] = await Promise.all([
                supabase.from('clients').select('id, full_name').eq('agent_id', user?.id).order('full_name'),
                supabase.from('margin_settings').select('iva_percent').eq('id', 1).maybeSingle(),
            ]);
            setClients(cs || []);
            if (ms?.iva_percent) setIvaPercent(ms.iva_percent);
        })();
    }, [user]);

    const p = request.parsed || {};
    const villa = match.villa;
    const basePrice = match.totalEur || 0;
    const withPlatform = basePrice * (1 + platformMargin / 100);
    const withAgent = withPlatform * (1 + agentMargin / 100);
    const ivaAmount = (withAgent - basePrice) * (ivaPercent / 100);
    const finalPrice = Math.round(withAgent + ivaAmount);

    async function handleCreate() {
        if (!selectedClientId) { setError('Seleziona un cliente'); return; }
        setSaving(true);
        setError(null);
        try {
            const breakdown = [
                { label: 'Base (AI match estimate)', amount: Math.round(basePrice), desc: villa.villa_name },
            ];
            if (platformMargin > 0) breakdown.push({ label: 'Platform Margin', amount: Math.round(withPlatform - basePrice), desc: 'Platform service fee' });
            if (agentMargin > 0) breakdown.push({ label: 'Agency Margin', amount: Math.round(withAgent - withPlatform), desc: 'Agency commission' });
            breakdown.push({ label: `IVA ${ivaPercent}%`, amount: Math.round(ivaAmount), desc: 'VAT on services' });

            const ins = {
                v_uuid: villa.v_uuid,
                client_id: selectedClientId,
                request_id: request.id,
                check_in: p.check_in || null,
                check_out: p.check_out || null,
                supplier_base_price: basePrice,
                admin_markup: platformMargin,
                agent_markup: agentMargin,
                editor_markup: 0,
                final_price: finalPrice,
                status: askOwnerPrice ? 'waiting_owner' : 'draft',
                agent_id: user?.id,
                price_breakdown: breakdown,
                group_details: {
                    type: p.group_type || 'family',
                    adults: p.guests_min || 2,
                    children: 0,
                    has_pets: p.has_pets || false,
                },
            };
            const { data, error } = await supabase.from('quotes').insert(ins).select('id').single();
            if (error) throw error;

            if (askOwnerPrice && villa.owner_id) {
                try {
                    await supabase.functions.invoke('notify-owner', {
                        body: { quoteId: data.id, action: 'request_approval' },
                    });
                } catch (e) {
                    console.warn('notify-owner failed', e);
                }
            }

            onCreated?.(data.id);
            navigate(`/quotes?openQuote=${data.id}`);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-lg overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div>
                        <h2 className="text-lg font-bold text-text-primary">Crea quote</h2>
                        <p className="text-xs text-text-muted truncate">{villa.villa_name}</p>
                    </div>
                    <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1">
                        <span className="material-symbols-outlined notranslate">close</span>
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-lg px-3 py-2">{error}</div>}

                    <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Cliente</label>
                        <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)} className="input-theme w-full">
                            <option value="">Seleziona cliente…</option>
                            {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                        </select>
                        {clients.length === 0 && (
                            <p className="text-[10px] text-amber-300 mt-1">Nessun cliente. Creane uno in /clients prima.</p>
                        )}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Platform %</label>
                            <input type="number" min="0" value={platformMargin} onChange={e => setPlatformMargin(parseFloat(e.target.value) || 0)} className="input-theme w-full text-sm" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Agent %</label>
                            <input type="number" min="0" value={agentMargin} onChange={e => setAgentMargin(parseFloat(e.target.value) || 0)} className="input-theme w-full text-sm" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">IVA %</label>
                            <input type="number" min="0" value={ivaPercent} onChange={e => setIvaPercent(parseFloat(e.target.value) || 0)} className="input-theme w-full text-sm" />
                        </div>
                    </div>

                    <div className="bg-surface-2 rounded-lg p-3 space-y-1 text-sm">
                        <Row label="Base" value={`€${Math.round(basePrice).toLocaleString()}`} />
                        {platformMargin > 0 && <Row label={`+ Platform ${platformMargin}%`} value={`€${Math.round(withPlatform - basePrice).toLocaleString()}`} />}
                        {agentMargin > 0 && <Row label={`+ Agent ${agentMargin}%`} value={`€${Math.round(withAgent - withPlatform).toLocaleString()}`} />}
                        <Row label={`+ IVA ${ivaPercent}%`} value={`€${Math.round(ivaAmount).toLocaleString()}`} />
                        <div className="border-t border-border pt-1 mt-1">
                            <Row label="Totale finale" value={`€${finalPrice.toLocaleString()}`} bold />
                        </div>
                        {p.budget_total_eur && (
                            <div className="text-[10px] text-text-muted">
                                Budget cliente: €{Number(p.budget_total_eur).toLocaleString()}
                                {finalPrice > p.budget_total_eur && <span className="text-amber-400 ml-1">(over)</span>}
                            </div>
                        )}
                    </div>

                    {villa.owner_id && (
                        <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer">
                            <input type="checkbox" checked={askOwnerPrice} onChange={e => setAskOwnerPrice(e.target.checked)} />
                            Chiedi conferma prezzo al proprietario (status = waiting_owner)
                        </label>
                    )}
                </div>

                <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-surface/40">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text-primary">Annulla</button>
                    <button onClick={handleCreate} disabled={saving || !selectedClientId} className="btn-primary text-sm disabled:opacity-50">
                        {saving ? 'Creazione…' : 'Crea quote'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Row({ label, value, bold }) {
    return (
        <div className="flex justify-between">
            <span className={`text-text-muted ${bold ? 'font-bold' : ''}`}>{label}</span>
            <span className={`text-text-primary ${bold ? 'font-black' : ''}`}>{value}</span>
        </div>
    );
}
