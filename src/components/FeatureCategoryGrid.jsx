import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

const CATEGORY_LABELS = {
    outdoor:  'Outdoor',
    indoor:   'Indoor',
    services: 'Services',
    view:     'View',
    wellness: 'Wellness',
    tech:     'Tech & Comfort',
};

const CATEGORY_ORDER = ['outdoor', 'indoor', 'view', 'wellness', 'services', 'tech'];

export default function FeatureCategoryGrid({ selected, onChange }) {
    const [catalog, setCatalog] = useState([]);
    const [loading, setLoading] = useState(true);
    const [customInput, setCustomInput] = useState('');

    useEffect(() => {
        let mounted = true;
        (async () => {
            const { data, error } = await supabase
                .from('amenity_catalog')
                .select('id, category, label, icon, sort_order')
                .eq('is_active', true)
                .order('category')
                .order('sort_order');
            if (!mounted) return;
            if (!error && data) setCatalog(data);
            setLoading(false);
        })();
        return () => { mounted = false; };
    }, []);

    const grouped = useMemo(() => {
        const out = {};
        for (const item of catalog) {
            if (!out[item.category]) out[item.category] = [];
            out[item.category].push(item);
        }
        return out;
    }, [catalog]);

    const catalogLabels = useMemo(() => new Set(catalog.map(c => c.label)), [catalog]);
    const customSelected = useMemo(
        () => selected.filter(s => !catalogLabels.has(s)),
        [selected, catalogLabels]
    );

    const toggle = (label) => {
        if (selected.includes(label)) onChange(selected.filter(s => s !== label));
        else onChange([...selected, label]);
    };

    const addCustom = () => {
        const v = customInput.trim();
        if (!v || selected.includes(v)) { setCustomInput(''); return; }
        onChange([...selected, v]);
        setCustomInput('');
    };

    return (
        <div className="space-y-5">
            {loading && <p className="text-xs text-text-muted italic">Loading amenities…</p>}

            {!loading && CATEGORY_ORDER.map(cat => {
                const items = grouped[cat];
                if (!items?.length) return null;
                return (
                    <div key={cat}>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">
                            {CATEGORY_LABELS[cat] || cat}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {items.map(item => {
                                const active = selected.includes(item.label);
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => toggle(item.label)}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-semibold transition-all ${
                                            active
                                                ? 'bg-primary/15 border-primary/40 text-primary'
                                                : 'bg-surface-2/40 border-border text-text-muted hover:border-primary/30 hover:text-text-primary'
                                        }`}
                                    >
                                        {item.icon && (
                                            <span className="material-symbols-outlined notranslate text-[14px]">
                                                {item.icon}
                                            </span>
                                        )}
                                        {item.label}
                                        {active && (
                                            <span className="material-symbols-outlined notranslate text-[14px]">check</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">
                    Custom
                </p>
                <div className="flex flex-wrap gap-2 mb-2">
                    {customSelected.map(label => (
                        <span
                            key={label}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 border border-primary/30 rounded-full text-[11px] font-bold text-primary"
                        >
                            {label}
                            <button
                                type="button"
                                onClick={() => onChange(selected.filter(s => s !== label))}
                                className="hover:text-text-primary transition-colors"
                            >
                                <span className="material-symbols-outlined notranslate text-[14px]">close</span>
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input
                        type="text"
                        className="input-theme flex-1"
                        placeholder="Add custom amenity (e.g. Helipad, Boat Dock…)"
                        value={customInput}
                        onChange={e => setCustomInput(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                addCustom();
                            }
                        }}
                    />
                    <button
                        type="button"
                        onClick={addCustom}
                        className="size-10 flex items-center justify-center bg-primary/20 text-primary border border-primary/30 rounded-lg hover:bg-primary/30 transition-all"
                    >
                        <span className="material-symbols-outlined notranslate">add</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
