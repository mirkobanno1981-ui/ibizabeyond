import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const DOCUMENT_TYPES = [
    { code: 'D', label: 'DNI / NIF (Spain)' },
    { code: 'P', label: 'Passport' },
    { code: 'C', label: 'EU Citizen Registration' },
    { code: 'I', label: 'Identity Card (Foreign)' },
    { code: 'N', label: 'NIE (Spain)' },
];

export default function GuestDetailsModal({ quoteId, onClose, onSuccess }) {
    const [guests, setGuests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [sendingToSes, setSendingToSes] = useState(false);

    useEffect(() => {
        if (quoteId) fetchGuests();
    }, [quoteId]);

    async function fetchGuests() {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('guests')
                .select('*, quote:quotes(ses_status, ses_submission_id)')
                .eq('quote_id', quoteId);
            
            if (error) throw error;
            setGuests(data || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }

    const updateGuestField = (id, field, value) => {
        setGuests(prev => prev.map(g => g.id === id ? { ...g, [field]: value } : g));
    };

    const handleSave = async () => {
        setSubmitting(true);
        try {
            for (const guest of guests) {
                const { error } = await supabase
                    .from('guests')
                    .update({
                        full_name: guest.full_name,
                        id_type: guest.id_type,
                        id_number: guest.id_number,
                        dob: guest.dob,
                        nationality: guest.nationality,
                        address_street: guest.address_street,
                        address_city: guest.address_city,
                        address_postal_code: guest.address_postal_code,
                        address_country: guest.address_country
                    })
                    .eq('id', guest.id);
                
                if (error) throw error;
            }
            alert('Guest details updated successfully.');
        } catch (err) {
            alert('Error saving guest details: ' + err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleSendToSes = async () => {
        if (!confirm('Are you sure you want to send this guest data to the Ministry of Interior?')) return;
        
        setSendingToSes(true);
        try {
            const { data, error } = await supabase.functions.invoke('ses-hospedajes-submit', {
                body: { quoteId }
            });

            if (error) throw error;

            if (data?.success) {
                alert('Success! Code: ' + data.code);
                onSuccess?.();
                onClose();
            } else {
                throw new Error(data?.message || 'Unknown error from SES API');
            }
        } catch (err) {
            console.error('SES Submission Error:', err);
            alert('Error sending to SES: ' + err.message);
        } finally {
            setSendingToSes(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-background rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl border border-border overflow-hidden animate-in zoom-in duration-300">
                {/* Header */}
                <header className="p-6 border-b border-border flex items-center justify-between bg-surface/50">
                    <div>
                        <h2 className="text-xl font-black text-text-primary uppercase tracking-tight">Guest Registry</h2>
                        {guests.length > 0 && guests[0].quote?.ses_status === 'sent' ? (
                            <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest mt-0.5">Reported to SES • Ref: {guests[0].quote?.ses_submission_id}</p>
                        ) : (
                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest mt-0.5">Review and verify data before Ministry submission</p>
                        )}
                    </div>
                    <button onClick={onClose} className="size-10 rounded-full bg-surface-2 flex items-center justify-center hover:bg-surface-3 transition-colors">
                        <span className="material-symbols-outlined notranslate">close</span>
                    </button>
                </header>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8">
                    {loading ? (
                        <div className="py-20 text-center">
                            <div className="animate-spin inline-block size-6 border-2 border-primary border-t-transparent rounded-full"></div>
                        </div>
                    ) : guests.length === 0 ? (
                        <div className="py-20 text-center space-y-4">
                            <span className="material-symbols-outlined notranslate text-5xl text-text-muted/20">person_off</span>
                            <p className="text-text-muted font-medium">No guest data has been submitted yet for this booking.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {guests.map((guest, idx) => (
                                <div key={guest.id} className="glass-card p-6 border-border/40 relative">
                                    <div className="flex justify-between items-start mb-6">
                                        <span className="text-[10px] font-black text-primary px-2 py-0.5 bg-primary/10 rounded-full uppercase tracking-widest">
                                            {guest.gender === 'M' ? 'Male' : 'Female'} • {guest.is_main_guest ? 'Lead Guest' : `Guest ${idx + 1}`}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="col-span-2">
                                            <label className="text-[9px] font-black text-text-muted uppercase tracking-widest mb-1 block">Full Name</label>
                                            <input 
                                                type="text" 
                                                value={guest.full_name} 
                                                onChange={(e) => updateGuestField(guest.id, 'full_name', e.target.value)}
                                                className="w-full bg-surface-2 text-xs font-bold p-2.5 rounded-lg border border-border"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[9px] font-black text-text-muted uppercase tracking-widest mb-1 block">ID Type</label>
                                            <select 
                                                value={guest.id_type}
                                                onChange={(e) => updateGuestField(guest.id, 'id_type', e.target.value)}
                                                className="w-full bg-surface-2 text-xs font-bold p-2.5 rounded-lg border border-border"
                                            >
                                                {DOCUMENT_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[9px] font-black text-text-muted uppercase tracking-widest mb-1 block">ID Number</label>
                                            <input 
                                                type="text" 
                                                value={guest.id_number} 
                                                onChange={(e) => updateGuestField(guest.id, 'id_number', e.target.value)}
                                                className="w-full bg-surface-2 text-xs font-bold p-2.5 rounded-lg border border-border"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[9px] font-black text-text-muted uppercase tracking-widest mb-1 block">DOB</label>
                                            <input 
                                                type="date" 
                                                value={guest.dob} 
                                                onChange={(e) => updateGuestField(guest.id, 'dob', e.target.value)}
                                                className="w-full bg-surface-2 text-xs font-bold p-2.5 rounded-lg border border-border"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[9px] font-black text-text-muted uppercase tracking-widest mb-1 block">Nationality</label>
                                            <input 
                                                type="text" 
                                                value={guest.nationality} 
                                                onChange={(e) => updateGuestField(guest.id, 'nationality', e.target.value)}
                                                className="w-full bg-surface-2 text-xs font-bold p-2.5 rounded-lg border border-border"
                                            />
                                        </div>
                                        <div className="col-span-2 pt-2 border-t border-border/20">
                                            <label className="text-[9px] font-black text-text-muted uppercase tracking-widest mb-1 block">Address</label>
                                            <div className="grid grid-cols-3 gap-2">
                                                <input 
                                                    className="col-span-2 bg-surface-2 text-[11px] font-medium p-2.5 rounded-lg border border-border"
                                                    placeholder="Street"
                                                    value={guest.address_street || ''}
                                                    onChange={(e) => updateGuestField(guest.id, 'address_street', e.target.value)}
                                                />
                                                <input 
                                                    className="bg-surface-2 text-[11px] font-medium p-2.5 rounded-lg border border-border"
                                                    placeholder="ZIP"
                                                    value={guest.address_postal_code || ''}
                                                    onChange={(e) => updateGuestField(guest.id, 'address_postal_code', e.target.value)}
                                                />
                                                <input 
                                                    className="col-span-2 bg-surface-2 text-[11px] font-medium p-2.5 rounded-lg border border-border"
                                                    placeholder="City"
                                                    value={guest.address_city || ''}
                                                    onChange={(e) => updateGuestField(guest.id, 'address_city', e.target.value)}
                                                />
                                                <input 
                                                    className="bg-surface-2 text-[11px] font-medium p-2.5 rounded-lg border border-border"
                                                    placeholder="Country (ISO3)"
                                                    value={guest.address_country || ''}
                                                    onChange={(e) => updateGuestField(guest.id, 'address_country', e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <footer className="p-6 border-t border-border bg-surface/50 flex flex-col md:flex-row gap-4 justify-between items-center">
                    <div className="flex items-center gap-2 text-[10px] text-text-muted font-bold uppercase tracking-widest">
                        <span className="material-symbols-outlined notranslate text-sm">info</span>
                        Changes are saved locally before sending to SES
                    </div>
                    <div className="flex gap-3 w-full md:w-auto">
                        <button 
                            onClick={onClose}
                            className="flex-1 md:flex-none px-6 py-3 text-xs font-black uppercase tracking-widest border border-border rounded-xl hover:bg-surface-2 transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleSave}
                            disabled={submitting || guests.length === 0}
                            className="flex-1 md:flex-none px-6 py-3 text-xs font-black uppercase tracking-widest bg-surface-2 border border-border rounded-xl hover:bg-surface-3 transition-colors disabled:opacity-50"
                        >
                            {submitting ? 'Saving...' : 'Save Changes'}
                        </button>
                        <button 
                            onClick={handleSendToSes}
                            disabled={sendingToSes || guests.length === 0}
                            className="flex-1 md:flex-none px-8 py-3 text-xs font-black uppercase tracking-widest bg-primary text-background-dark rounded-xl shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
                        >
                            {sendingToSes ? 'Transferring...' : 'Send to Ministry'}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
}
