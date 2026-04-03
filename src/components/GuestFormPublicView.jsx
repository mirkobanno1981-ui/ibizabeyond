import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const DOCUMENT_TYPES = [
    { code: 'D', label: 'DNI / NIF (Spain)' },
    { code: 'P', label: 'Passport' },
    { code: 'C', label: 'EU Citizen Registration' },
    { code: 'I', label: 'Identity Card (Foreign)' },
    { code: 'N', label: 'NIE (Spain)' },
];

const GENDERS = [
    { code: 'M', label: 'Male' },
    { code: 'F', label: 'Female' },
];

export default function GuestFormPublicView() {
    const { token } = useParams();
    const navigate = useNavigate();
    const [quote, setQuote] = useState(null);
    const [villa, setVilla] = useState(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);
    
    const [guests, setGuests] = useState([
        { 
            full_name: '', 
            id_type: 'P', 
            id_number: '', 
            dob: '', 
            nationality: 'ITA', 
            gender: 'M',
            address_street: '',
            address_city: '',
            address_postal_code: '',
            address_country: 'ITA',
            is_main_guest: true
        }
    ]);

    useEffect(() => {
        if (token) fetchQuote();
    }, [token]);

    async function fetchQuote() {
        setLoading(true);
        try {
            const { data, error: err } = await supabase
                .from('quotes')
                .select('*, invenio_properties(*)')
                .eq('guest_form_token', token)
                .single();

            if (err || !data) throw new Error('Invalid or expired link.');
            if (data.status !== 'booked') throw new Error('This form is only available for confirmed bookings.');

            setQuote(data);
            setVilla(data.invenio_properties);
            
            // Check if already filled
            const { data: existingGuests } = await supabase
                .from('guests')
                .select('*')
                .eq('quote_id', data.id);
            
            if (existingGuests && existingGuests.length > 0) {
                setSuccess(true);
            }

        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    const addGuest = () => {
        setGuests([...guests, { 
            full_name: '', 
            id_type: 'P', 
            id_number: '', 
            dob: '', 
            nationality: 'ITA', 
            gender: 'M',
            address_street: '',
            address_city: '',
            address_postal_code: '',
            address_country: 'ITA',
            is_main_guest: false 
        }]);
    };

    const removeGuest = (index) => {
        if (guests.length === 1) return;
        setGuests(guests.filter((_, i) => i !== index));
    };

    const updateGuest = (index, field, value) => {
        const newGuests = [...guests];
        newGuests[index][field] = value;
        setGuests(newGuests);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            // Validate all guests over 14? For now just basic validation
            for (const g of guests) {
                if (!g.full_name || !g.id_number || !g.dob) {
                    throw new Error('Please fill in all required fields for every guest.');
                }
            }

            const guestsToInsert = guests.map(g => ({
                ...g,
                quote_id: quote.id
            }));

            const { error: insErr } = await supabase
                .from('guests')
                .insert(guestsToInsert);

            if (insErr) throw insErr;

            await supabase
                .from('quotes')
                .update({ 
                    guest_form_filled: true,
                    status: 'check_in_ready'
                })
                .eq('id', quote.id);

            setSuccess(true);
        } catch (err) {
            alert(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return (
        <div className="min-h-screen bg-background flex items-center justify-center">
            <div className="animate-spin size-8 border-2 border-primary border-t-transparent rounded-full"></div>
        </div>
    );

    if (error) return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8 text-center">
            <span className="material-symbols-outlined notranslate text-red-500 text-5xl mb-4">error</span>
            <h1 className="text-xl font-bold text-text-primary">{error}</h1>
            <p className="text-text-muted mt-2">Please contact your booking agent for assistance.</p>
        </div>
    );

    if (success) return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-500">
            <div className="size-20 bg-green-500/10 rounded-full flex items-center justify-center mb-6 border border-green-500/20">
                <span className="material-symbols-outlined notranslate text-green-500 text-4xl">done_all</span>
            </div>
            <h1 className="text-2xl font-black text-text-primary uppercase tracking-tight">Data Submitted Successfully</h1>
            <p className="text-text-muted mt-4 max-w-sm">Thank you for completing the guest check-in. This information is required by the Spanish Ministry of Interior for your stay at <strong>{villa?.villa_name}</strong>.</p>
            <p className="text-primary font-bold mt-8">We look forward to welcoming you soon!</p>
        </div>
    );

    return (
        <div className="min-h-screen bg-background pb-20">
            <nav className="h-20 border-b border-border bg-background/80 backdrop-blur-xl flex items-center px-6 md:px-12 sticky top-0 z-50">
                <div className="font-black text-text-primary tracking-tighter text-xl">IBIZA BEYOND <span className="text-primary">CHECK-IN</span></div>
            </nav>

            <main className="max-w-3xl mx-auto px-6 pt-12">
                <header className="mb-12">
                    <h1 className="text-4xl font-black text-text-primary tracking-tight uppercase">Guest Information</h1>
                    <p className="text-text-muted mt-2 font-medium">As per Spanish Law 4/2015, all travelers staying in holiday rentals must be registered with the authorities.</p>
                    
                    <div className="mt-8 glass-card p-6 border-primary/20 bg-primary/5 flex items-center gap-4">
                        <span className="material-symbols-outlined notranslate text-primary text-3xl">villa</span>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-primary/60">Booking Reference</p>
                            <p className="font-bold text-text-primary leading-tight">{villa?.villa_name} • {new Date(quote?.check_in).toLocaleDateString()} to {new Date(quote?.check_out).toLocaleDateString()}</p>
                        </div>
                    </div>
                </header>

                <form onSubmit={handleSubmit} className="space-y-12">
                    {guests.map((guest, index) => (
                        <section key={index} className="glass-card p-8 border-border/40 relative animate-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: `${index * 100}ms` }}>
                            {index > 0 && (
                                <button 
                                    type="button" 
                                    onClick={() => removeGuest(index)}
                                    className="absolute top-6 right-6 text-red-500/50 hover:text-red-500 transition-colors"
                                >
                                    <span className="material-symbols-outlined notranslate">delete</span>
                                </button>
                            )}
                            
                            <h3 className="text-xs font-black text-text-muted uppercase tracking-[0.2em] mb-8 flex items-center gap-2">
                                <span className="size-5 rounded-full bg-surface-2 flex items-center justify-center text-[10px] text-text-primary">{index + 1}</span>
                                {index === 0 ? 'Main Traveler' : `Guest ${index + 1}`}
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="md:col-span-2">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-2 block">Full Name (as per ID/Passport)</label>
                                    <input 
                                        required
                                        type="text" 
                                        value={guest.full_name}
                                        onChange={(e) => updateGuest(index, 'full_name', e.target.value)}
                                        className="w-full input-theme py-3 px-4" 
                                        placeholder="e.g. John Hammond"
                                    />
                                </div>

                                <div>
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-2 block">ID Document Type</label>
                                    <select 
                                        value={guest.id_type}
                                        onChange={(e) => updateGuest(index, 'id_type', e.target.value)}
                                        className="w-full input-theme py-3 px-4"
                                    >
                                        {DOCUMENT_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                                    </select>
                                </div>

                                <div>
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-2 block">Document Number</label>
                                    <input 
                                        required
                                        type="text" 
                                        value={guest.id_number}
                                        onChange={(e) => updateGuest(index, 'id_number', e.target.value)}
                                        className="w-full input-theme py-3 px-4" 
                                        placeholder="Passport / ID number"
                                    />
                                </div>

                                <div>
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-2 block">Date of Birth</label>
                                    <input 
                                        required
                                        type="date" 
                                        value={guest.dob}
                                        onChange={(e) => updateGuest(index, 'dob', e.target.value)}
                                        className="w-full input-theme py-3 px-4"
                                    />
                                </div>

                                <div>
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-2 block">Gender</label>
                                    <select 
                                        value={guest.gender}
                                        onChange={(e) => updateGuest(index, 'gender', e.target.value)}
                                        className="w-full input-theme py-3 px-4"
                                    >
                                        {GENDERS.map(g => <option key={g.code} value={g.code}>{g.label}</option>)}
                                    </select>
                                </div>

                                <div>
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-2 block">Nationality (Country Code)</label>
                                    <input 
                                        required
                                        type="text" 
                                        maxLength="3"
                                        value={guest.nationality}
                                        onChange={(e) => updateGuest(index, 'nationality', e.target.value.toUpperCase())}
                                        className="w-full input-theme py-3 px-4" 
                                        placeholder="e.g. GBR, ITA, FRA"
                                    />
                                </div>

                                <div>
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-2 block">Country of Residence</label>
                                    <input 
                                        required
                                        type="text" 
                                        maxLength="3"
                                        value={guest.address_country}
                                        onChange={(e) => updateGuest(index, 'address_country', e.target.value.toUpperCase())}
                                        className="w-full input-theme py-3 px-4" 
                                        placeholder="e.g. GBR, ITA, DEU"
                                    />
                                </div>

                                <div className="md:col-span-2 space-y-4 pt-4 border-t border-border/20">
                                    <p className="text-[10px] font-black text-text-muted uppercase tracking-widest">Permanent Address</p>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="md:col-span-2">
                                            <input 
                                                required
                                                type="text" 
                                                value={guest.address_street}
                                                onChange={(e) => updateGuest(index, 'address_street', e.target.value)}
                                                className="w-full input-theme py-3 px-4" 
                                                placeholder="Street and Number"
                                            />
                                        </div>
                                        <div>
                                            <input 
                                                required
                                                type="text" 
                                                value={guest.address_postal_code}
                                                onChange={(e) => updateGuest(index, 'address_postal_code', e.target.value)}
                                                className="w-full input-theme py-3 px-4" 
                                                placeholder="Postal Code"
                                            />
                                        </div>
                                        <div>
                                            <input 
                                                required
                                                type="text" 
                                                value={guest.address_city}
                                                onChange={(e) => updateGuest(index, 'address_city', e.target.value)}
                                                className="w-full input-theme py-3 px-4" 
                                                placeholder="City"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>
                    ))}

                    <div className="flex flex-col gap-6">
                        <button 
                            type="button" 
                            onClick={addGuest}
                            className="w-full py-4 border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 rounded-2xl flex items-center justify-center gap-3 text-text-muted hover:text-primary transition-all font-bold"
                        >
                            <span className="material-symbols-outlined notranslate">add_circle</span>
                            Add Another Guest
                        </button>

                        <button 
                            disabled={submitting}
                            type="submit"
                            className="w-full py-6 bg-primary text-background-dark rounded-3xl font-black uppercase tracking-widest shadow-2xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                        >
                            {submitting ? 'Registering...' : 'Complete Registration'}
                        </button>
                    </div>
                </form>
            </main>
        </div>
    );
}
