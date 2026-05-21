import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listClientRequests, deleteClientRequest } from '../lib/clientRequestApi';
import NewClientRequestModal from './NewClientRequestModal';

const STATUS_LABELS = {
    new: 'Nuova',
    parsed: 'Analizzata',
    matched: 'Match trovati',
    quoted: 'Quote inviate',
    closed: 'Chiusa',
};

const STATUS_STYLES = {
    new:     'bg-blue-500/20 text-blue-300',
    parsed:  'bg-violet-500/20 text-violet-300',
    matched: 'bg-amber-500/20 text-amber-300',
    quoted:  'bg-green-500/20 text-green-300',
    closed:  'bg-zinc-500/20 text-zinc-300',
};

export default function ClientRequestsPage() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all');
    const [showNew, setShowNew] = useState(false);

    async function load() {
        setLoading(true);
        try {
            const rows = await listClientRequests();
            setItems(rows);
        } catch (err) {
            console.error('[ClientRequestsPage] load failed', err);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    const visible = filter === 'all' ? items : items.filter(r => r.status === filter);

    async function handleDelete(id) {
        if (!confirm('Eliminare definitivamente questa richiesta?')) return;
        await deleteClientRequest(id);
        load();
    }

    return (
        <div className="p-6 md:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary">Richieste Cliente</h1>
                    <p className="text-text-muted text-sm mt-0.5">
                        {loading ? 'Loading…' : `${visible.length} richieste${filter !== 'all' ? ` (${STATUS_LABELS[filter]})` : ''}`}
                    </p>
                </div>
                <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2 text-sm self-start">
                    <span className="material-symbols-outlined notranslate text-[16px]">add</span>
                    Nuova richiesta
                </button>
            </div>

            <div className="flex flex-wrap gap-2">
                <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>Tutte</FilterChip>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <FilterChip key={k} active={filter === k} onClick={() => setFilter(k)}>{v}</FilterChip>
                ))}
            </div>

            {loading ? (
                <div className="text-center py-16 text-text-muted">Loading…</div>
            ) : visible.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <span className="material-symbols-outlined notranslate text-5xl text-text-muted mb-3 block">forum</span>
                    <p className="text-text-muted text-sm">Nessuna richiesta. Crea la prima incollando un testo.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {visible.map(r => (
                        <RequestCard key={r.id} request={r} onDelete={() => handleDelete(r.id)} />
                    ))}
                </div>
            )}

            {showNew && (
                <NewClientRequestModal
                    onClose={() => setShowNew(false)}
                    onCreated={() => {
                        setShowNew(false);
                        load();
                    }}
                />
            )}
        </div>
    );
}

function FilterChip({ active, onClick, children }) {
    return (
        <button
            onClick={onClick}
            className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide border transition ${
                active
                    ? 'bg-primary text-background border-primary'
                    : 'bg-surface border-border text-text-muted hover:text-text-primary'
            }`}
        >{children}</button>
    );
}

function RequestCard({ request, onDelete }) {
    const p = request.parsed || {};
    const excerpt = (request.raw_text || '').slice(0, 140).replace(/\n+/g, ' ');
    const statusStyle = STATUS_STYLES[request.status] || STATUS_STYLES.new;
    return (
        <div className="glass-card p-4 flex flex-col gap-3 hover:border-primary/30 transition">
            <div className="flex items-start justify-between gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusStyle}`}>
                    {STATUS_LABELS[request.status] || request.status}
                </span>
                <div className="flex gap-1">
                    <button onClick={onDelete} title="Elimina" className="text-text-muted hover:text-red-400 p-1">
                        <span className="material-symbols-outlined notranslate text-[16px]">delete</span>
                    </button>
                </div>
            </div>

            <p className="text-sm text-text-primary line-clamp-3 italic">"{excerpt}{request.raw_text?.length > 140 ? '…' : ''}"</p>

            <div className="flex flex-wrap gap-1.5">
                {p.bedrooms_min ? <Tag icon="bed">{p.bedrooms_min}+ bed</Tag> : null}
                {p.guests_min ? <Tag icon="group">{p.guests_min}+</Tag> : null}
                {p.check_in && p.check_out ? <Tag icon="calendar_month">{p.check_in} → {p.check_out}</Tag> : null}
                {p.budget_total_eur ? <Tag icon="euro">€{Number(p.budget_total_eur).toLocaleString()}</Tag> : null}
                {p.area_preference ? <Tag icon="location_on">{p.area_preference}</Tag> : null}
                {(p.amenities || []).slice(0, 3).map(a => <Tag key={a} icon="star">{a}</Tag>)}
                {p.amenities?.length > 3 && <Tag icon="more_horiz">+{p.amenities.length - 3}</Tag>}
            </div>

            <div className="flex items-center justify-between mt-auto pt-2 border-t border-border/40">
                <span className="text-[10px] text-text-muted">
                    {new Date(request.created_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
                <Link
                    to={`/requests/${request.id}`}
                    className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                >
                    Apri
                    <span className="material-symbols-outlined notranslate text-[14px]">arrow_forward</span>
                </Link>
            </div>
        </div>
    );
}

function Tag({ icon, children }) {
    return (
        <span className="inline-flex items-center gap-1 bg-surface-2 px-2 py-0.5 rounded-full text-[10px] text-text-muted">
            <span className="material-symbols-outlined notranslate text-[11px]">{icon}</span>
            {children}
        </span>
    );
}
