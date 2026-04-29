import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

function SearchableSelect({ label, placeholder, value, valueLabel, items, onPick, onCreate, disabled }) {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const wrapRef = useRef(null);

    useEffect(() => {
        const onClick = e => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) {
                setOpen(false);
                setInput('');
            }
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    const trimmed = input.trim();
    const lower = trimmed.toLowerCase();
    const filtered = trimmed
        ? items.filter(it => it.name.toLowerCase().includes(lower))
        : items;
    const exactMatch = items.some(it => it.name.toLowerCase() === lower);
    const showCreate = trimmed.length > 0 && !exactMatch && !disabled;

    const display = value ? valueLabel : '';

    return (
        <div ref={wrapRef} className="relative">
            <label className="block text-xs text-text-muted mb-1.5 font-medium">{label}</label>
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen(o => !o)}
                className="input-theme w-full text-left flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <span className={display ? 'text-text-primary' : 'text-text-muted'}>
                    {display || placeholder}
                </span>
                <span className="material-symbols-outlined notranslate text-[16px] text-text-muted">
                    {open ? 'expand_less' : 'expand_more'}
                </span>
            </button>
            {open && !disabled && (
                <div className="absolute z-30 left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-2xl">
                    <input
                        type="text"
                        autoFocus
                        className="input-theme w-full rounded-b-none border-0 border-b border-border"
                        placeholder="Type to search or create new..."
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && showCreate) {
                                e.preventDefault();
                                onCreate(trimmed);
                                setInput('');
                                setOpen(false);
                            }
                        }}
                    />
                    <ul className="max-h-60 overflow-y-auto">
                        {filtered.slice(0, 100).map(it => (
                            <li
                                key={it.id}
                                onMouseDown={e => {
                                    e.preventDefault();
                                    onPick(it);
                                    setInput('');
                                    setOpen(false);
                                }}
                                className={`px-3 py-2 text-xs cursor-pointer hover:bg-primary/10 ${
                                    value === it.id ? 'bg-primary/15 text-primary font-bold' : 'text-text-primary'
                                }`}
                            >
                                {it.name}
                            </li>
                        ))}
                        {showCreate && (
                            <li
                                onMouseDown={e => {
                                    e.preventDefault();
                                    onCreate(trimmed);
                                    setInput('');
                                    setOpen(false);
                                }}
                                className="px-3 py-2 text-xs text-primary hover:bg-primary/10 cursor-pointer flex items-center gap-2 border-t border-border"
                            >
                                <span className="material-symbols-outlined notranslate text-[14px]">add</span>
                                Create new: <span className="font-bold">"{trimmed}"</span>
                            </li>
                        )}
                        {filtered.length === 0 && !showCreate && (
                            <li className="px-3 py-2 text-xs text-text-muted italic">
                                {disabled ? 'Pick a city first' : 'No matches'}
                            </li>
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}

export default function CityAreaPicker({
    cityId,
    areaId,
    onChange, // ({ cityId, cityName, areaId, areaName })
}) {
    const [cities, setCities] = useState([]);
    const [areas, setAreas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let mounted = true;
        (async () => {
            const { data, error } = await supabase.from('cities').select('id, name').order('name');
            if (!mounted) return;
            if (error) setError(error.message);
            else setCities(data || []);
            setLoading(false);
        })();
        return () => { mounted = false; };
    }, []);

    useEffect(() => {
        let mounted = true;
        if (!cityId) { setAreas([]); return; }
        (async () => {
            const { data, error } = await supabase
                .from('areas')
                .select('id, name, city_id')
                .eq('city_id', cityId)
                .order('name');
            if (!mounted) return;
            if (error) setError(error.message);
            else setAreas(data || []);
        })();
        return () => { mounted = false; };
    }, [cityId]);

    const cityObj = cities.find(c => c.id === cityId);
    const areaObj = areas.find(a => a.id === areaId);

    const handleCreateCity = async (name) => {
        setError(null);
        const { data, error } = await supabase
            .from('cities')
            .insert([{ name }])
            .select()
            .single();
        if (error) { setError(error.message); return; }
        setCities(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        onChange({ cityId: data.id, cityName: data.name, areaId: null, areaName: '' });
    };

    const handlePickCity = (city) => {
        onChange({ cityId: city.id, cityName: city.name, areaId: null, areaName: '' });
    };

    const handleCreateArea = async (name) => {
        if (!cityId) return;
        setError(null);
        const { data, error } = await supabase
            .from('areas')
            .insert([{ name, city_id: cityId }])
            .select()
            .single();
        if (error) { setError(error.message); return; }
        setAreas(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        onChange({ cityId, cityName: cityObj?.name || '', areaId: data.id, areaName: data.name });
    };

    const handlePickArea = (area) => {
        onChange({ cityId, cityName: cityObj?.name || '', areaId: area.id, areaName: area.name });
    };

    if (loading) {
        return <p className="text-xs text-text-muted">Loading cities...</p>;
    }

    return (
        <div className="grid grid-cols-2 gap-4">
            <SearchableSelect
                label="City"
                placeholder="Select city..."
                value={cityId}
                valueLabel={cityObj?.name}
                items={cities}
                onPick={handlePickCity}
                onCreate={handleCreateCity}
            />
            <SearchableSelect
                label="Area"
                placeholder={cityId ? 'Select area...' : 'Pick a city first'}
                value={areaId}
                valueLabel={areaObj?.name}
                items={areas}
                onPick={handlePickArea}
                onCreate={handleCreateArea}
                disabled={!cityId}
            />
            {error && (
                <p className="col-span-2 text-[10px] text-red-400">{error}</p>
            )}
        </div>
    );
}
