import React, { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { useGlobalSettings } from '../contexts/GlobalSettingsContext';
import PendingApproval from './PendingApproval';

const NavItem = ({ to, icon, label, end = false }) => (
    <NavLink
        to={to}
        end={end}
        className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive
                ? 'bg-primary/10 text-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
            }`
        }
    >
        <span className="material-symbols-outlined notranslate text-[20px] notranslate">{icon}</span>
        <span>{label}</span>
    </NavLink>
);

export default function Layout() {
    const { user, role, agentData, signOut } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const { villas_enabled, boats_enabled } = useGlobalSettings();
    const navigate = useNavigate();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState({ villas: [], clients: [] });
    const [showResults, setShowResults] = useState(false);
    const [isSuspended, setIsSuspended] = useState(false);
    const [isPending, setIsPending] = useState(false);
    const [isRejected, setIsRejected] = useState(false);
    const [checkingStatus, setCheckingStatus] = useState(true);
    const [agentProfile, setAgentProfile] = useState(null);
    const searchRef = useRef(null);

    useEffect(() => {
        const checkAgentStatus = () => {
            try {
                // Safety Timeout: ensure we don't hang in "checkingStatus" forever
                const timer = setTimeout(() => {
                    setCheckingStatus(false);
                }, 5000);

                if (user?.id) {
                    // Reuse agentData from AuthContext if available to avoid redundant fetch
                    const data = agentData;
                    
                    if (data) {
                        setAgentProfile(data);
                        if (role === 'agent' || role === 'agency_admin') {
                            if (data.is_active === false) {
                                setIsSuspended(true);
                            } else if (data.status === 'pending') {
                                setIsPending(true);
                            } else if (data.status === 'rejected') {
                                setIsRejected(true);
                            }
                        }
                    } else if (role === 'admin' || role === 'super_admin' || role === 'owner') {
                        // Admins and owners don't necessarily have an agent profile
                        setCheckingStatus(false);
                    }
                }
                
                // If we already have user and role, we can likely stop checking soon
                if (user && role) {
                    setCheckingStatus(false);
                }

                return () => clearTimeout(timer);
            } catch (error) {
                console.error("Layout status check error:", error);
                setCheckingStatus(false);
            }
        };
        
        checkAgentStatus();

        const handleClickOutside = (e) => {
            if (searchRef.current && !searchRef.current.contains(e.target)) {
                setShowResults(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [user?.id, role, agentData]);

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
                    .limit(villas_enabled ? 5 : 0),
                supabase
                    .from('clients')
                    .select('id, full_name, email')
                    .or(`full_name.ilike.%${query}%,email.ilike.%${query}%`)
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
        <aside className="flex flex-col w-64 h-full bg-surface border-r border-border">
            {/* Logo */}
            <div className="p-6 pb-4">
                <div className="flex items-center gap-3">
                    <div className="size-9 rounded-lg bg-primary/20 flex items-center justify-center">
                        <span className="material-symbols-outlined notranslate text-primary text-[18px] notranslate">diamond</span>
                    </div>
                    <div>
                        <p className="text-sm font-bold text-text-primary leading-tight">Ibiza Beyond</p>
                        <p className="text-[10px] text-primary/80 uppercase tracking-widest">{role} Portal</p>
                    </div>
                </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto py-2">
                <p className="text-[10px] text-text-muted uppercase tracking-widest font-semibold px-3 pt-2 pb-1">Main</p>
                <NavItem to="/" icon="dashboard" label="Dashboard" end />
                {villas_enabled && <NavItem to="/villas" icon="villa" label="Villa Inventory" />}
                {boats_enabled && <NavItem to="/boats" icon="directions_boat" label="Boat Charter" />}

                <p className="text-[10px] text-text-muted uppercase tracking-widest font-semibold px-3 pt-4 pb-1">Business</p>
                <NavItem to="/clients" icon="group" label="Clients" />
                <NavItem to="/quotes" icon="request_quote" label="Quotes" />
                <NavItem to="/bookings" icon="calendar_month" label="Bookings" />
                <NavItem to="/profile" icon={role === 'owner' ? 'person' : 'badge'} label={role === 'owner' ? 'Owner Settings' : 'Branding Settings'} />
                {role === 'owner' && <NavItem to="/owners" icon="groups" label="Owners" />}
                {(agentProfile?.agent_type === 'agency' || role === 'agency_admin') && (
                    <NavItem to="/team" icon="groups" label="Team" />
                )}

                {(role === 'admin' || role === 'super_admin') && (
                    <>
                        <p className="text-[10px] text-text-muted uppercase tracking-widest font-semibold px-3 pt-4 pb-1">Admin</p>
                        <NavItem to="/agents" icon="manage_accounts" label="Agents" />
                        <NavItem to="/owners" icon="groups" label="Owners" />
                        {role === 'super_admin' && (
                            <NavItem to="/payouts" icon="payments" label="Payouts & Profits" />
                        )}
                    </>
                )}
            </nav>

            {/* User profile */}
            <div className="p-3 border-t border-border">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-background/50">
                    <div className="size-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-bold flex-shrink-0">
                        {avatarLetter}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text-primary truncate">{displayName}</p>
                        <div className="flex items-center gap-1">
                            <p className="text-[11px] text-text-muted capitalize">{role} access</p>
                            <span className="text-[9px] text-red-500 font-bold bg-red-500/10 px-1 rounded">v1.0.5 TEST</span>
                        </div>
                    </div>
                    <button
                        onClick={handleSignOut}
                        title="Sign out"
                        className="p-1 text-text-muted hover:text-red-400 transition-colors"
                    >
                        <span className="material-symbols-outlined notranslate text-[18px] notranslate">logout</span>
                    </button>
                </div>
            </div>
        </aside>
    );

    if (checkingStatus) {
        return (
            <div className="h-screen w-full flex items-center justify-center bg-background">
                <div className="animate-spin size-8 border-2 border-primary border-t-transparent rounded-full"></div>
            </div>
        );
    }

    if (isSuspended || isRejected) {
        return (
            <div className="h-screen w-full flex flex-col items-center justify-center bg-background p-6 text-center">
                <div className="size-20 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 mb-6 animate-pulse">
                    <span className="material-symbols-outlined notranslate text-4xl notranslate">block</span>
                </div>
                <h1 className="text-3xl font-black text-text-primary mb-2 uppercase tracking-tighter">
                    {isSuspended ? 'Account Suspended' : 'Access Restricted'}
                </h1>
                <p className="text-text-secondary max-w-md mb-8">
                    {isSuspended 
                        ? 'Your agent portal access has been temporarily disabled by the administrator.'
                        : 'Your account application has been reviewed and rejected. Please contact support for more details.'}
                </p>
                <div className="flex flex-col gap-3 w-full max-w-xs">
                    <button 
                        onClick={handleSignOut}
                        className="py-3 px-6 bg-surface-2 border border-border hover:bg-surface-2 rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
                    >
                        <span className="material-symbols-outlined notranslate">logout</span>
                        Sign Out
                    </button>
                </div>
            </div>
        );
    }

    if (isPending) {
        return <PendingApproval />;
    }

    return (
        <div className="relative flex h-screen w-full overflow-hidden bg-background text-text-primary font-display">
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
                <header className="h-14 flex items-center justify-between px-5 border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-10 flex-shrink-0">
                    <div className="flex items-center gap-3 flex-1">
                        <button
                            className="md:hidden text-text-muted hover:text-text-primary"
                            onClick={() => setMobileOpen(true)}
                        >
                            <span className="material-symbols-outlined notranslate">menu</span>
                        </button>
                        <div className="relative max-w-xs w-full hidden sm:block" ref={searchRef}>
                            <span className="material-symbols-outlined notranslate absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px] notranslate">search</span>
                            <input
                                className="w-full pl-9 pr-4 py-1.5 bg-background/70 border border-border rounded-lg text-sm placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 text-text-primary"
                                placeholder="Search villas, clients..."
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={handleSearchKeyDown}
                                onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
                            />

                            {/* Search Results Dropdown */}
                            {showResults && (searchQuery.length >= 2) && (
                                <div className="absolute top-full left-0 w-full mt-2 bg-surface border border-border rounded-xl shadow-2xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-200">
                                    {searchResults.villas.length === 0 && searchResults.clients.length === 0 ? (
                                        <div className="p-4 text-center text-xs text-text-muted">No results found for "{searchQuery}"</div>
                                    ) : (
                                        <div className="max-h-[70vh] overflow-y-auto">
                                            {searchResults.villas.length > 0 && (
                                                <div className="p-2 border-b border-border/50">
                                                    <p className="px-2 pb-1.5 text-[10px] text-text-muted font-bold uppercase tracking-wider">Villas</p>
                                                    {searchResults.villas.map(v => (
                                                        <button 
                                                            key={v.v_uuid}
                                                            onClick={() => {
                                                                navigate(`/villas/${v.v_uuid}`);
                                                                setShowResults(false);
                                                                setSearchQuery('');
                                                            }}
                                                            className="w-full text-left px-2 py-2 rounded-lg hover:bg-surface-2 flex items-center gap-3 group transition-colors"
                                                        >
                                                            <span className="material-symbols-outlined notranslate text-[18px] text-text-muted group-hover:text-primary notranslate">villa</span>
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-semibold text-text-primary truncate">{v.villa_name}</p>
                                                                <p className="text-[10px] text-text-muted truncate">{v.areaname || 'Ibiza'}</p>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}

                                            {searchResults.clients.length > 0 && (
                                                <div className="p-2">
                                                    <p className="px-2 pb-1.5 text-[10px] text-text-muted font-bold uppercase tracking-wider">Clients</p>
                                                    {searchResults.clients.map(c => (
                                                        <button 
                                                            key={c.id}
                                                            onClick={() => {
                                                                navigate('/clients');
                                                                setShowResults(false);
                                                                setSearchQuery('');
                                                            }}
                                                            className="w-full text-left px-2 py-2 rounded-lg hover:bg-surface-2 flex items-center gap-3 group transition-colors"
                                                        >
                                                            <span className="material-symbols-outlined notranslate text-[18px] text-text-muted group-hover:text-primary notranslate">person</span>
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-semibold text-text-primary truncate">{c.full_name}</p>
                                                                <p className="text-[10px] text-text-muted truncate">{c.email}</p>
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
                    <div className="flex items-center gap-3 ml-3">
                        <button className="relative p-2 text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-lg transition-colors">
                            <span className="material-symbols-outlined notranslate text-[20px] notranslate">notifications</span>
                            <span className="absolute top-2 right-2 size-1.5 bg-primary rounded-full"></span>
                        </button>
                        <button 
                            onClick={toggleTheme}
                            className="p-2 text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-lg transition-colors"
                            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                        >
                            <span className="material-symbols-outlined notranslate text-[20px] notranslate">
                                {theme === 'dark' ? 'light_mode' : 'dark_mode'}
                            </span>
                        </button>
                        <button 
                            onClick={() => navigate('/profile')}
                            className="flex items-center gap-3 pl-3 py-1 pr-1 border-l border-border group"
                        >
                            <div className="text-right hidden sm:block">
                                <p className="text-sm font-bold text-text-primary group-hover:text-primary transition-colors truncate max-w-[120px]">
                                    {agentProfile?.company_name || displayName}
                                </p>
                                <p className="text-[10px] text-text-muted uppercase tracking-widest font-black">
                                    {role} portal
                                </p>
                            </div>
                            <div className="size-8 rounded-full bg-primary/20 border border-border flex items-center justify-center text-primary text-xs font-bold overflow-hidden shadow-lg group-hover:border-primary/50 transition-all">
                                {agentProfile?.logo_url ? (
                                    <img src={agentProfile.logo_url} className="w-full h-full object-cover" alt="Profile" />
                                ) : (
                                    avatarLetter
                                )}
                            </div>
                        </button>
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
