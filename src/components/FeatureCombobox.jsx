import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function FeatureCombobox({ selected, onChange }) {
    const [allFeatures, setAllFeatures] = useState([]);
    const [input, setInput] = useState('');
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);

    useEffect(() => {
        let mounted = true;
        (async () => {
            const { data, error } = await supabase
                .from('properties')
                .select('features')
                .not('features', 'is', null);
            if (error || !mounted) return;
            const set = new Set();
            for (const row of data) {
                if (Array.isArray(row.features)) {
                    for (const f of row.features) {
                        if (f && typeof f === 'string') set.add(f.trim());
                    }
                }
            }
            setAllFeatures([...set].sort((a, b) => a.localeCompare(b)));
        })();
        return () => { mounted = false; };
    }, []);

    useEffect(() => {
        const onClick = e => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    const trimmed = input.trim();
    const lower = trimmed.toLowerCase();
    const suggestions = trimmed
        ? allFeatures.filter(f => f.toLowerCase().includes(lower) && !selected.includes(f))
        : allFeatures.filter(f => !selected.includes(f));
    const exactMatch = allFeatures.some(f => f.toLowerCase() === lower);
    const showCreate = trimmed.length > 0 && !exactMatch && !selected.includes(trimmed);

    const addFeature = (value) => {
        const v = value.trim();
        if (!v || selected.includes(v)) return;
        onChange([...selected, v]);
        if (!allFeatures.some(f => f.toLowerCase() === v.toLowerCase())) {
            setAllFeatures(prev => [...prev, v].sort((a, b) => a.localeCompare(b)));
        }
        setInput('');
        setOpen(false);
    };

    const removeFeature = (f) => {
        onChange(selected.filter(x => x !== f));
    };

    return (
        <div ref={wrapRef} className="relative">
            <div className="flex flex-wrap gap-2 mb-3">
                {selected.map(f => (
                    <span key={f} className="flex items-center gap-1.5 px-3 py-1 bg-primary/10 border border-primary/20 rounded-full text-[11px] font-bold text-primary animate-in zoom-in duration-200">
                        {f}
                        <button
                            type="button"
                            onClick={() => removeFeature(f)}
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
                    placeholder="Search or add feature (e.g. Infinity Pool, Gym...)"
                    value={input}
                    onFocus={() => setOpen(true)}
                    onChange={e => { setInput(e.target.value); setOpen(true); }}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && trimmed) {
                            e.preventDefault();
                            addFeature(trimmed);
                        } else if (e.key === 'Escape') {
                            setOpen(false);
                        }
                    }}
                />
                <button
                    type="button"
                    onClick={() => trimmed && addFeature(trimmed)}
                    className="size-10 flex items-center justify-center bg-primary/20 text-primary border border-primary/30 rounded-lg hover:bg-primary/30 transition-all"
                >
                    <span className="material-symbols-outlined notranslate">add</span>
                </button>
            </div>
            {open && (suggestions.length > 0 || showCreate) && (
                <ul className="absolute z-20 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-surface border border-border rounded-lg shadow-2xl">
                    {suggestions.slice(0, 50).map(f => (
                        <li
                            key={f}
                            onMouseDown={e => { e.preventDefault(); addFeature(f); }}
                            className="px-3 py-2 text-xs text-text-primary hover:bg-primary/10 cursor-pointer flex items-center gap-2"
                        >
                            <span className="material-symbols-outlined notranslate text-[14px] text-text-muted">label</span>
                            {f}
                        </li>
                    ))}
                    {showCreate && (
                        <li
                            onMouseDown={e => { e.preventDefault(); addFeature(trimmed); }}
                            className="px-3 py-2 text-xs text-primary hover:bg-primary/10 cursor-pointer flex items-center gap-2 border-t border-border"
                        >
                            <span className="material-symbols-outlined notranslate text-[14px]">add</span>
                            Add new: <span className="font-bold">"{trimmed}"</span>
                        </li>
                    )}
                </ul>
            )}
        </div>
    );
}
