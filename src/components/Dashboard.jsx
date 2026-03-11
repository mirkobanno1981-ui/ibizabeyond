import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { fetchICal, parseICal, isAvailable } from '../lib/calendar';

function StatCard({ icon, label, value, sub, accent }) {
    return (
        <div className="stat-card flex items-start gap-4">
            <div className={`p-2.5 rounded-lg ${accent || 'bg-primary/10'}`}>
                <span className={`material-symbols-outlined text-[22px] ${accent ? 'text-white' : 'text-primary'}`}>{icon}</span>
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">{label}</p>
                <p className="text-2xl font-bold text-white">{value}</p>
                {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
            </div>
        </div>
    );
}

export default function Dashboard() {
    const { role, user } = useAuth();
    const navigate = useNavigate();
    const [stats, setStats] = useState({ villas: 0, quotes: 0, clients: 0 });
    const [allVillas, setAllVillas] = useState([]);
    const [filteredVillas, setFilteredVillas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchParams, setSearchParams] = useState({
        query: '',
        guests: '',
        checkIn: '',
        checkOut: '',
        features: []
    });
    const [availableFeatures, setAvailableFeatures] = useState([]);

    const displayName = user?.user_metadata?.first_name
        ? user.user_metadata.first_name
        : user?.email?.split('@')[0] || 'Agent';

    useEffect(() => {
        fetchDashboardData();
    }, []);

    useEffect(() => {
        // Initial load or when villas change, show some recommended
        if (allVillas.length > 0 && !searchParams.query && !searchParams.checkIn && !searchParams.checkOut) {
            applyFilters();
        }
    }, [allVillas]);

    async function fetchDashboardData() {
        try {
            const quotesQuery = supabase.from('quotes').select('id', { count: 'exact', head: true });
            const clientsQuery = supabase.from('clients').select('id', { count: 'exact', head: true });

            if (role !== 'admin') {
                quotesQuery.eq('agent_id', user.id);
                clientsQuery.eq('agent_id', user.id);
            }

            const [villasRes, quotesRes, clientsRes] = await Promise.all([
                supabase.from('invenio_properties').select('v_uuid', { count: 'exact', head: true }),
                quotesQuery,
                clientsQuery,
            ]);

            // Fetch ALL villas for client-side search (109 rows is fine)
            const { data: villasData } = await supabase
                .from('invenio_properties')
                .select('v_uuid, villa_name, bedrooms, bathrooms, sleeps, minimum_price, maximum_price, areaname, features, ical_url')
                .order('villa_name', { ascending: true });

            // Unique features for the filter
            const feats = new Set();
            villasData?.forEach(v => (v.features || []).forEach(f => feats.add(f)));
            setAvailableFeatures(Array.from(feats).sort());

            // Fetch cover photos
            let villaThumbnails = {};
            if (villasData && villasData.length > 0) {
                const ids = villasData.map(v => v.v_uuid);
                const { data: photosData } = await supabase
                    .from('invenio_photos')
                    .select('v_uuid, thumbnail_url')
                    .in('v_uuid', ids)
                    .eq('sort_order', 0);

                (photosData || []).forEach(p => {
                    if (p.v_uuid && p.thumbnail_url) {
                        villaThumbnails[p.v_uuid] = p.thumbnail_url;
                    }
                });
            }

            const processedVillas = (villasData || []).map(v => ({
                ...v,
                thumbnail: villaThumbnails[v.v_uuid] || null,
            }));

            setStats({
                villas: villasRes.count || 0,
                quotes: quotesRes.count || 0,
                clients: clientsRes.count || 0,
            });
            setAllVillas(processedVillas);
        } catch (err) {
            console.error('Dashboard data error:', err);
        } finally {
            setLoading(false);
        }
    }

    async function applyFilters() {
        let filtered = allVillas.filter(v => {
            const matchQuery = !searchParams.query || 
                v.villa_name.toLowerCase().includes(searchParams.query.toLowerCase()) ||
                (v.areaname && v.areaname.toLowerCase().includes(searchParams.query.toLowerCase()));
            const matchGuests = !searchParams.guests || (v.sleeps || 0) >= parseInt(searchParams.guests);
            const matchFeatures = searchParams.features.length === 0 || 
                searchParams.features.every(f => (v.features || []).includes(f));
            
            return matchQuery && matchGuests && matchFeatures;
        });

        // Availability filter (Warning: sequential fetches for filtered results)
        if (searchParams.checkIn && searchParams.checkOut) {
            // To keep it responsive, we only check the first 12 filtered results for availability
            const limited = filtered.slice(0, 12);
            const availabilityResults = await Promise.all(limited.map(async v => {
                if (!v.ical_url) return true;
                const data = await fetchICal(v.ical_url);
                if (!data) return true;
                const events = parseICal(data);
                return isAvailable(events, searchParams.checkIn, searchParams.checkOut);
            }));
            
            filtered = limited.filter((_, idx) => availabilityResults[idx]);
        } else {
            filtered = filtered.slice(0, 6); // Limit initial view
        }

        setFilteredVillas(filtered);
    }

    const FALLBACK = 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=400&q=60';

    return (
        <div className="p-6 md:p-8 space-y-8">
            {/* Header */}
            <div>
                <p className="text-slate-500 text-sm">Welcome back,</p>
                <h1 className="text-2xl font-bold text-white">
                    {displayName} <span className="text-primary">✦</span>
                </h1>
                <p className="text-slate-500 text-sm mt-0.5 capitalize">{role} — Ibiza Beyond Agent Portal</p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon="villa" label="Total Villas" value={loading ? '—' : stats.villas} sub="Active inventory" />
                <StatCard icon="request_quote" label="My Quotes" value={loading ? '—' : stats.quotes} sub="Issued quotes" />
                <StatCard icon="group" label="My Clients" value={loading ? '—' : stats.clients} sub="Registered clients" />
                <StatCard
                    icon="diamond"
                    label="Status"
                    value={role === 'admin' ? 'Admin' : 'Agent'}
                    sub="Account type"
                    accent="bg-primary"
                />
            </div>

            {/* Recommended Villas Section */}
            <div>
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-white">Recommended Villas</h2>
                        <p className="text-sm text-slate-500 mt-1">Hand-picked properties for your portfolio</p>
                    </div>
                    <button
                        onClick={() => navigate('/villas')}
                        className="btn-primary text-sm flex items-center gap-2"
                    >
                        Explore All Inventory <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                    </button>
                </div>

                {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="glass-card animate-pulse h-52" />
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredVillas.map(villa => (
                            <div
                                key={villa.v_uuid}
                                onClick={() => navigate(`/villas/${villa.v_uuid}`)}
                                className="glass-card overflow-hidden cursor-pointer group hover:border-primary/40 transition-all"
                            >
                                <div className="h-44 overflow-hidden bg-surface-dark2">
                                    <img
                                        src={villa.thumbnail || FALLBACK}
                                        alt={villa.villa_name}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                        onError={e => { e.target.src = FALLBACK; }}
                                        loading="lazy"
                                    />
                                </div>
                                <div className="p-4">
                                    <div className="flex justify-between items-start mb-1">
                                        <p className="font-bold text-white truncate">{villa.villa_name}</p>
                                        <span className="text-primary font-bold text-xs">€{Math.round(villa.minimum_price).toLocaleString()}</span>
                                    </div>
                                    <p className="text-xs text-slate-500">{villa.areaname || 'Ibiza'} • {villa.bedrooms} bd • Sleeps {villa.sleeps}</p>
                                </div>
                            </div>
                        ))}
                        {filteredVillas.length === 0 && (
                            <div className="col-span-full py-12 text-center glass-card">
                                <p className="text-slate-500">No villas available at the moment.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Quick actions */}
            <div className="glass-card p-5">
                <h2 className="text-sm font-bold text-white mb-3">{role === 'admin' ? 'Admin' : 'Agent'} Quick Actions</h2>
                <div className="flex flex-wrap gap-3">
                    {role === 'admin' ? (
                        <>
                        <button
                            onClick={() => navigate('/agents?add=true')}
                            className="btn-primary text-sm flex items-center gap-2"
                        >
                            <span className="material-symbols-outlined text-[16px]">person_add</span>
                            Create Agent
                        </button>
                        <button
                            onClick={() => navigate('/settings')}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border-dark text-sm text-slate-300 hover:border-primary/30 hover:text-primary transition-all font-medium"
                        >
                            <span className="material-symbols-outlined text-[16px]">tune</span>
                            Set Margins
                        </button>
                        <button
                            onClick={() => navigate('/agents')}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border-dark text-sm text-slate-300 hover:border-primary/30 hover:text-primary transition-all font-medium"
                        >
                            <span className="material-symbols-outlined text-[16px]">manage_accounts</span>
                            Manage Agents
                        </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => navigate('/villas')}
                                className="btn-primary text-sm flex items-center gap-2"
                            >
                                <span className="material-symbols-outlined text-[16px]">add</span>
                                Create Quote
                            </button>
                            <button
                                onClick={() => navigate('/profile')}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border-dark text-sm text-slate-300 hover:border-primary/30 hover:text-primary transition-all font-medium"
                            >
                                <span className="material-symbols-outlined text-[16px]">badge</span>
                                Branding Settings
                            </button>
                            <button
                                onClick={() => navigate('/clients')}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border-dark text-sm text-slate-300 hover:border-primary/30 hover:text-primary transition-all font-medium"
                            >
                                <span className="material-symbols-outlined text-[16px]">person_add</span>
                                Add Client
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
