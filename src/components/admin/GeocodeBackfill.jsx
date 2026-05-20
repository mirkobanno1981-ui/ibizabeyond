import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const RATE_LIMIT_MS = 220; // ~4.5 req/s, safely under Google's per-second quota

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

export default function GeocodeBackfill() {
    const [counts, setCounts] = useState({ cities: 0, areas: 0, villas: 0 });
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0, lastError: null });
    const [log, setLog] = useState([]);

    const refresh = async () => {
        setLoading(true);
        try {
            const [c, a, v] = await Promise.all([
                supabase
                    .from('cities')
                    .select('id', { count: 'exact', head: true })
                    .is('centroid_gps', null),
                supabase
                    .from('areas')
                    .select('id', { count: 'exact', head: true })
                    .is('centroid_gps', null),
                supabase
                    .from('properties')
                    .select('v_uuid', { count: 'exact', head: true })
                    .is('gps', null)
                    .is('indicative_gps', null),
            ]);
            setCounts({
                cities: c.count || 0,
                areas: a.count || 0,
                villas: v.count || 0,
            });
        } catch (err) {
            console.error('[GeocodeBackfill] refresh failed:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { refresh(); }, []);

    const appendLog = (line) => setLog(prev => [...prev.slice(-50), line]);

    const runBackfill = async () => {
        if (running) return;
        setRunning(true);
        setLog([]);
        try {
            const { data: cities = [] } = await supabase
                .from('cities')
                .select('id, name')
                .is('centroid_gps', null);
            const { data: areas = [] } = await supabase
                .from('areas')
                .select('id, name, cities(name)')
                .is('centroid_gps', null);
            const { data: villas = [] } = await supabase
                .from('properties')
                .select('v_uuid, villa_name, areaname, district')
                .is('gps', null)
                .is('indicative_gps', null);

            const total = cities.length + areas.length + villas.length;
            setProgress({ done: 0, total, lastError: null });
            let done = 0;

            for (const c of cities) {
                try {
                    const { data, error } = await supabase.functions.invoke('geocode-location', {
                        body: { query: c.name, target: { kind: 'city', id: c.id } },
                    });
                    if (error || data?.error) throw new Error(error?.message || data?.error);
                    appendLog(`city "${c.name}" → ${data.gps} (${data.provider})`);
                } catch (err) {
                    appendLog(`city "${c.name}" FAILED: ${err?.message || err}`);
                    setProgress(p => ({ ...p, lastError: err?.message || String(err) }));
                }
                done += 1;
                setProgress(p => ({ ...p, done }));
                await sleep(RATE_LIMIT_MS);
            }

            for (const a of areas) {
                try {
                    const q = a.cities?.name ? `${a.name}, ${a.cities.name}` : a.name;
                    const { data, error } = await supabase.functions.invoke('geocode-location', {
                        body: { query: q, target: { kind: 'area', id: a.id } },
                    });
                    if (error || data?.error) throw new Error(error?.message || data?.error);
                    appendLog(`area "${q}" → ${data.gps} (${data.provider})`);
                } catch (err) {
                    appendLog(`area "${a.name}" FAILED: ${err?.message || err}`);
                    setProgress(p => ({ ...p, lastError: err?.message || String(err) }));
                }
                done += 1;
                setProgress(p => ({ ...p, done }));
                await sleep(RATE_LIMIT_MS);
            }

            for (const v of villas) {
                const parts = [v.areaname, v.district].map(s => (s || '').trim()).filter(Boolean);
                if (parts.length === 0) {
                    appendLog(`villa "${v.villa_name}" SKIPPED: no area/district text`);
                    done += 1;
                    setProgress(p => ({ ...p, done }));
                    continue;
                }
                try {
                    const { data, error } = await supabase.functions.invoke('geocode-location', {
                        body: { query: parts.join(', '), target: { kind: 'villa', id: v.v_uuid } },
                    });
                    if (error || data?.error) throw new Error(error?.message || data?.error);
                    appendLog(`villa "${v.villa_name}" → ${data.gps} (${data.provider})`);
                } catch (err) {
                    appendLog(`villa "${v.villa_name}" FAILED: ${err?.message || err}`);
                    setProgress(p => ({ ...p, lastError: err?.message || String(err) }));
                }
                done += 1;
                setProgress(p => ({ ...p, done }));
                await sleep(RATE_LIMIT_MS);
            }
        } catch (err) {
            console.error('[GeocodeBackfill] run failed:', err);
        } finally {
            setRunning(false);
            refresh();
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
                <div className="bg-primary/10 p-2 rounded-lg">
                    <span className="material-symbols-outlined notranslate text-primary">my_location</span>
                </div>
                <div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-text-primary">
                        Geocode Backfill
                    </h3>
                    <p className="text-xs text-text-muted">
                        Auto-locate cities, areas and villas missing GPS by sending their text to Google.
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="text-xs text-text-muted">Loading counts…</div>
            ) : (
                <div className="grid grid-cols-3 gap-3 text-xs">
                    <div className="rounded-lg border border-border bg-surface-2 p-3">
                        <div className="text-text-muted">Cities without centroid</div>
                        <div className="text-2xl font-bold text-text-primary">{counts.cities}</div>
                    </div>
                    <div className="rounded-lg border border-border bg-surface-2 p-3">
                        <div className="text-text-muted">Areas without centroid</div>
                        <div className="text-2xl font-bold text-text-primary">{counts.areas}</div>
                    </div>
                    <div className="rounded-lg border border-border bg-surface-2 p-3">
                        <div className="text-text-muted">Villas without any GPS</div>
                        <div className="text-2xl font-bold text-text-primary">{counts.villas}</div>
                    </div>
                </div>
            )}

            <div className="flex items-center gap-3">
                <button
                    onClick={runBackfill}
                    disabled={running || (counts.cities + counts.areas + counts.villas === 0)}
                    className="bg-primary hover:bg-primary/90 disabled:opacity-50 text-background-dark font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2"
                >
                    <span className="material-symbols-outlined notranslate text-[18px]">
                        {running ? 'sync' : 'play_arrow'}
                    </span>
                    {running ? `Running ${progress.done}/${progress.total}` : 'Geocode missing'}
                </button>
                <button
                    onClick={refresh}
                    disabled={running || loading}
                    className="text-xs text-text-muted hover:text-primary"
                >
                    Refresh counts
                </button>
            </div>

            {running && progress.total > 0 && (
                <div className="w-full h-1 bg-surface-2 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${(progress.done / progress.total) * 100}%` }}
                    />
                </div>
            )}

            {progress.lastError && (
                <div className="text-[10px] text-red-400">Last error: {progress.lastError}</div>
            )}

            {log.length > 0 && (
                <pre className="max-h-48 overflow-auto text-[10px] font-mono bg-surface-2 border border-border rounded-lg p-2 text-text-muted">
                    {log.join('\n')}
                </pre>
            )}
        </div>
    );
}
