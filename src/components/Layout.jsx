import React, { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const NavItem = ({ to, icon, label, end = false }) => (
    <NavLink
        to={to}
        end={end}
        className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive
                ? 'bg-primary/10 text-primary'
                : 'text-slate-400 hover:text-slate-100 hover:bg-white/5'
            }`
        }
    >
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
        <span>{label}</span>
    </NavLink>
);

export default function Layout() {
    const { user, role, signOut } = useAuth();
    const navigate = useNavigate();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState({ villas: [], clients: [] });
    const [showResults, setShowResults] = useState(false);
    const searchRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (searchRef.current && !searchRef.current.contains(e.target)) {
                setShowResults(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const performSearch = async (query) => {
        if (!query || query.length < 2) {
            setSearchResults({ villas: [], clients: [] });
            return;
        }

        try {
            const [villasRes, clientsRes] = await Promise.all([
                supabase
                    .from('invenio_properties')
                    .select('v_uuid, villa_name, areaname')
                    .or(`villa_name.ilike.%${query}%,areaname.ilike.%${query}%`)
                    .limit(5),
                supabase
                    .from('clients')
                    .select('id, first_name, last_name')
                    .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
                    .limit(5)
            ]);

            setSearchResults({
                villas: villasRes.data || [],
                clients: clientsRes.data || []
            });
            setShowResults(true);
        } catch (err) {
            console.error('Global search error:', err);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchQuery.length >= 2) {
                performSearch(searchQuery);
            } else {
                setSearchResults({ villas: [], clients: [] });
                setShowResults(false);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const handleSearchKeyDown = (e) => {
        if (e.key === 'Enter') {
            if (searchResults.villas.length > 0) {
                navigate(`/villas/${searchResults.villas[0].v_uuid}`);
                setShowResults(false);
                setSearchQuery('');
            } else if (searchResults.clients.length > 0) {
                navigate('/clients');
                setShowResults(false);
                setSearchQuery('');
            }
        }
    };


    const handleSignOut = async () => {
        await signOut();
        navigate('/login');
    };

    const displayName = user?.user_metadata?.first_name
        ? `${user.user_metadata.first_name} ${user.user_metadata.last_name || ''}`
        : user?.email?.split('@')[0] || 'User';

    const avatarLetter = (user?.user_metadata?.first_name || user?.email || 'U').charAt(0).toUpperCase();

    const Sidebar = () => (
        <aside className="flex flex-col w-64 h-full bg-surface-dark border-r border-border-dark">
            {/* Logo */}
            <div className="p-6 pb-4">
                <div className="flex items-center gap-3">
                    <div className="size-9 rounded-lg bg-primary/20 flex items-center justify-center">
                        <span className="material-symbols-outlined text-primary text-[18px]">diamond</span>
                    </div>
                    <div>
                        <p className="text-sm font-bold text-white leading-tight">Ibiza Beyond</p>
                        <p className="text-[10px] text-primary/80 uppercase tracking-widest">Agent Portal</p>
                    </div>
                </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto py-2">
                <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold px-3 pt-2 pb-1">Main</p>
                <NavItem to="/" icon="dashboard" label="Dashboard" end />
                <NavItem to="/villas" icon="villa" label="Villa Inventory" />

                <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold px-3 pt-4 pb-1">Business</p>
                <NavItem to="/clients" icon="group" label="Clients" />
                <NavItem to="/quotes" icon="request_quote" label="Quotes" />
                <NavItem to="/profile" icon="badge" label="Branding Settings" />

                {role === 'admin' && (
                    <>
                        <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold px-3 pt-4 pb-1">Admin</p>
                        <NavItem to="/settings" icon="tune" label="Margin Settings" />
                        <NavItem to="/agents" icon="manage_accounts" label="Agents" />
                    </>
                )}
            </nav>

            {/* User profile */}
            <div className="p-3 border-t border-border-dark">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-background-dark/50">
                    <div className="size-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-bold flex-shrink-0">
                        {avatarLetter}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{displayName}</p>
                        <p className="text-[11px] text-slate-500 capitalize">{role} access</p>
                    </div>
                    <button
                        onClick={handleSignOut}
                        title="Sign out"
                        className="p-1 text-slate-600 hover:text-red-400 transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">logout</span>
                    </button>
                </div>
            </div>
        </aside>
    );

    return (
        <div className="relative flex h-screen w-full overflow-hidden bg-background-dark text-slate-100 font-display">
            {/* Desktop sidebar */}
            <div className="hidden md:block h-full flex-shrink-0">
                <Sidebar />
            </div>

            {/* Mobile sidebar overlay */}
            {mobileOpen && (
                <div className="fixed inset-0 z-50 flex md:hidden">
                    <div className="h-full">
                        <Sidebar />
                    </div>
                    <div
                        className="flex-1 bg-black/60 backdrop-blur-sm"
                        onClick={() => setMobileOpen(false)}
                    />
                </div>
            )}

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Top header */}
                <header className="h-14 flex items-center justify-between px-5 border-b border-border-dark bg-surface-dark/80 backdrop-blur-md sticky top-0 z-10 flex-shrink-0">
                    <div className="flex items-center gap-3 flex-1">
                        <button
                            className="md:hidden text-slate-400 hover:text-white"
                            onClick={() => setMobileOpen(true)}
                        >
                            <span className="material-symbols-outlined">menu</span>
                        </button>
                        <div className="relative max-w-xs w-full hidden sm:block" ref={searchRef}>
                            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[18px]">search</span>
                            <input
                                className="w-full pl-9 pr-4 py-1.5 bg-background-dark/70 border border-border-dark rounded-lg text-sm placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 text-slate-200"
                                placeholder="Search villas, clients..."
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={handleSearchKeyDown}
                                onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
                            />

                            {/* Search Results Dropdown */}
                            {showResults && (searchQuery.length >= 2) && (
                                <div className="absolute top-full left-0 w-full mt-2 bg-surface-dark border border-border-dark rounded-xl shadow-2xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-200">
                                    {searchResults.villas.length === 0 && searchResults.clients.length === 0 ? (
                                        <div className="p-4 text-center text-xs text-slate-500">No results found for "{searchQuery}"</div>
                                    ) : (
                                        <div className="max-h-[70vh] overflow-y-auto">
                                            {searchResults.villas.length > 0 && (
                                                <div className="p-2 border-b border-border-dark/50">
                                                    <p className="px-2 pb-1.5 text-[10px] text-slate-600 font-bold uppercase tracking-wider">Villas</p>
                                                    {searchResults.villas.map(v => (
                                                        <button 
                                                            key={v.v_uuid}
                                                            onClick={() => {
                                                                navigate(`/villas/${v.v_uuid}`);
                                                                setShowResults(false);
                                                                setSearchQuery('');
                                                            }}
                                                            className="w-full text-left px-2 py-2 rounded-lg hover:bg-white/5 flex items-center gap-3 group transition-colors"
                                                        >
                                                            <span className="material-symbols-outlined text-[18px] text-slate-500 group-hover:text-primary">villa</span>
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-semibold text-white truncate">{v.villa_name}</p>
                                                                <p className="text-[10px] text-slate-500 truncate">{v.areaname || 'Ibiza'}</p>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}

                                            {searchResults.clients.length > 0 && (
                                                <div className="p-2">
                                                    <p className="px-2 pb-1.5 text-[10px] text-slate-600 font-bold uppercase tracking-wider">Clients</p>
                                                    {searchResults.clients.map(c => (
                                                        <button 
                                                            key={c.id}
                                                            onClick={() => {
                                                                navigate('/clients');
                                                                setShowResults(false);
                                                                setSearchQuery('');
                                                            }}
                                                            className="w-full text-left px-2 py-2 rounded-lg hover:bg-white/5 flex items-center gap-3 group transition-colors"
                                                        >
                                                            <span className="material-symbols-outlined text-[18px] text-slate-500 group-hover:text-primary">person</span>
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-semibold text-white truncate">{c.first_name} {c.last_name}</p>
                                                                <p className="text-[10px] text-slate-500 uppercase tracking-tighter">Client Profile</p>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 ml-3">
                        <button className="relative p-2 text-slate-500 hover:text-slate-200 hover:bg-white/5 rounded-lg transition-colors">
                            <span className="material-symbols-outlined text-[20px]">notifications</span>
                            <span className="absolute top-2 right-2 size-1.5 bg-primary rounded-full"></span>
                        </button>
                        <div className="size-7 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                            {avatarLetter}
                        </div>
                    </div>
                </header>

                {/* Page content */}
                <div className="flex-1 overflow-y-auto">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
