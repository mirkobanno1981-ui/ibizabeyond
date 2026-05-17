import React, { useState } from 'react';
import VoiceCapture from './VoiceCapture';

const FIELD_LABELS = {
    villa_name: 'Name',
    tagline: 'Tagline',
    description: 'Description',
    property_type: 'Type',
    areaname: 'Area',
    district: 'Municipality',
    license: 'License',
    gps: 'GPS',
    bedrooms: 'Bedrooms',
    bathrooms: 'Bathrooms',
    sleeps: 'Sleeps',
    minimum_nights: 'Min nights',
    minimum_price: 'Min price',
    maximum_price: 'Max price',
    cleaning_charge: 'Cleaning',
    deposit: 'Deposit',
    allow_shortstays: 'Short stays',
    features: 'Features',
    // boat fields
    boat_name: 'Name',
    boat_type: 'Type',
    length_meters: 'Length (m)',
    max_guests: 'Max guests',
    cabins: 'Cabins',
    location_base_port: 'Base port',
    daily_rate: 'Daily rate',
    weekly_rate: 'Weekly rate',
};

function formatValue(v) {
    if (v === null || v === undefined || v === '') return <span className="italic text-text-muted">—</span>;
    if (Array.isArray(v)) return v.length === 0 ? <span className="italic text-text-muted">(empty)</span> : v.join(', ');
    const s = String(v);
    if (s.length > 280) return s.slice(0, 280) + '…';
    return s;
}

// Generic AI edit overlay. Accepts:
//   currentRow: object of editable scalar fields (from form state).
//   onRequestPatch: async ({ text, audioFile }) => { patch, notes }
//   onApply(patch): apply accepted patch to parent form.
//   onClose(): dismiss overlay.
export default function AiEditOverlay({ currentRow, onRequestPatch, onApply, onClose }) {
    const [text, setText] = useState('');
    const [audioFile, setAudioFile] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [patch, setPatch] = useState(null);
    const [notes, setNotes] = useState(null);
    const [excluded, setExcluded] = useState(new Set());

    const handleRun = async () => {
        setError(null);
        if (!text.trim() && !audioFile) {
            setError('Type an instruction or record audio first.');
            return;
        }
        setBusy(true);
        try {
            const result = await onRequestPatch({ text, audioFile });
            setPatch(result?.patch || {});
            setNotes(result?.notes || null);
            setExcluded(new Set());
        } catch (err) {
            setError(err?.message || String(err));
        } finally {
            setBusy(false);
        }
    };

    const toggleExclude = (k) => {
        setExcluded(prev => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k); else next.add(k);
            return next;
        });
    };

    const handleApply = () => {
        if (!patch) return;
        const accepted = {};
        for (const [k, v] of Object.entries(patch)) {
            if (!excluded.has(k)) accepted[k] = v;
        }
        onApply(accepted);
        onClose();
    };

    const patchKeys = patch ? Object.keys(patch) : [];

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-surface border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
                <div className="flex items-center gap-3 p-5 border-b border-border">
                    <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                        <span className="material-symbols-outlined notranslate">auto_awesome</span>
                    </div>
                    <div className="flex-1">
                        <h3 className="text-base font-bold text-text-primary">AI edit</h3>
                        <p className="text-[11px] text-text-muted">Describe the change in text or voice. Review the diff before applying.</p>
                    </div>
                    <button onClick={onClose} className="p-2 text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-lg">
                        <span className="material-symbols-outlined notranslate">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-sm">{error}</div>
                    )}

                    {!patch && (
                        <>
                            <div>
                                <label className="block text-xs text-text-muted mb-1.5 font-medium">Instruction</label>
                                <textarea
                                    className="input-theme w-full resize-none"
                                    rows={4}
                                    placeholder="e.g. Drop the price to 800-1100, add jacuzzi and EV charger to features, rewrite the description to highlight the sea view"
                                    value={text}
                                    onChange={e => setText(e.target.value)}
                                />
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                                <VoiceCapture onRecorded={setAudioFile} />
                                {audioFile && (
                                    <span className="inline-flex items-center gap-2 text-[11px] text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 rounded">
                                        <span className="material-symbols-outlined notranslate text-[14px]">check_circle</span>
                                        Audio attached ({(audioFile.size / 1024).toFixed(0)} KB)
                                        <button onClick={() => setAudioFile(null)} className="ml-1 text-red-400 hover:underline">remove</button>
                                    </span>
                                )}
                            </div>
                        </>
                    )}

                    {patch && (
                        <>
                            {notes && (
                                <div className="bg-primary/10 border border-primary/30 text-primary p-3 rounded-lg text-xs">
                                    <span className="font-bold uppercase tracking-widest mr-2">AI notes:</span>
                                    {notes}
                                </div>
                            )}
                            {patchKeys.length === 0 ? (
                                <div className="text-sm text-text-muted italic text-center py-6">
                                    No changes proposed. Refine the instruction and try again.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-text-muted">
                                        {patchKeys.length} field{patchKeys.length > 1 ? 's' : ''} will change · uncheck any you don't want
                                    </p>
                                    {patchKeys.map(k => {
                                        const before = currentRow[k];
                                        const after = patch[k];
                                        const dropped = excluded.has(k);
                                        return (
                                            <div
                                                key={k}
                                                className={`border rounded-xl p-3 ${dropped ? 'border-border bg-surface-2/30 opacity-50' : 'border-primary/30 bg-primary/5'}`}
                                            >
                                                <div className="flex items-center gap-3 mb-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={!dropped}
                                                        onChange={() => toggleExclude(k)}
                                                        className="accent-primary"
                                                    />
                                                    <span className="text-xs font-bold text-text-primary uppercase tracking-wider">
                                                        {FIELD_LABELS[k] || k}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-2 gap-3 text-xs">
                                                    <div className="bg-red-500/5 border border-red-500/20 p-2 rounded">
                                                        <p className="text-[9px] font-black uppercase tracking-widest text-red-400 mb-1">Before</p>
                                                        <div className="text-text-muted whitespace-pre-wrap break-words">{formatValue(before)}</div>
                                                    </div>
                                                    <div className="bg-emerald-500/5 border border-emerald-500/20 p-2 rounded">
                                                        <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500 mb-1">After</p>
                                                        <div className="text-text-primary whitespace-pre-wrap break-words">{formatValue(after)}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="p-4 border-t border-border flex justify-end gap-3">
                    {!patch ? (
                        <>
                            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary transition-all">
                                Cancel
                            </button>
                            <button
                                onClick={handleRun}
                                disabled={busy || (!text.trim() && !audioFile)}
                                className="btn-primary text-sm disabled:opacity-50 flex items-center gap-2"
                            >
                                <span className="material-symbols-outlined notranslate text-[16px]">
                                    {busy ? 'hourglass_empty' : 'auto_awesome'}
                                </span>
                                {busy ? 'Thinking...' : 'Propose changes'}
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => { setPatch(null); setNotes(null); setExcluded(new Set()); }}
                                className="px-4 py-2 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary"
                            >
                                Refine
                            </button>
                            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary">
                                Cancel
                            </button>
                            <button
                                onClick={handleApply}
                                disabled={patchKeys.length === 0 || patchKeys.every(k => excluded.has(k))}
                                className="btn-primary text-sm disabled:opacity-50 flex items-center gap-2"
                            >
                                <span className="material-symbols-outlined notranslate text-[16px]">check</span>
                                Apply changes
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
