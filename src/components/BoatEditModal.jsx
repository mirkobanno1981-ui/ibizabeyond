import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const Field = ({ label, field, form, handleChange, type = 'text', fullWidth = false, placeholder = '' }) => (
    <div className={fullWidth ? 'col-span-2' : ''}>
        <label className="block text-xs text-text-muted mb-1.5 font-medium">{label}</label>
        {type === 'textarea' ? (
            <textarea
                className="input-theme w-full resize-none"
                rows={3}
                placeholder={placeholder}
                value={form[field] || ''}
                onChange={e => handleChange(field, e.target.value)}
            />
        ) : (
            <input
                type={type}
                className="input-theme w-full"
                placeholder={placeholder}
                value={form[field] || ''}
                onChange={e => handleChange(field, e.target.value)}
            />
        )}
    </div>
);

export default function BoatEditModal({ boat, onClose, onSaved }) {
    const { role } = useAuth();
    const [owners, setOwners] = useState([]);
    const [form, setForm] = useState({
        boat_name: boat.boat_name || '',
        manufacturer: boat.manufacturer || '',
        model: boat.model || '',
        year: boat.year || new Date().getFullYear(),
        type: boat.type || 'Motor',
        length_ft: boat.length_ft || 0,
        beam_ft: boat.beam_ft || 0,
        draft_ft: boat.draft_ft || 0,
        guest_capacity_day: boat.guest_capacity_day || 12,
        guest_capacity_overnight: boat.guest_capacity_overnight || 0,
        cabins: boat.cabins || 0,
        bathrooms: boat.bathrooms || 0,
        daily_price: boat.daily_price || 0,
        weekly_price: boat.weekly_price || 0,
        security_deposit: boat.security_deposit || 0,
        cleaning_fee: boat.cleaning_fee || 0,
        fuel_policy: boat.fuel_policy || 'Paid by Consumption',
        skipper_type: boat.skipper_type || 'Required',
        tagline: boat.tagline || '',
        description: boat.description || '',
        thumbnail_url: boat.thumbnail_url || '',
        registration_number: boat.registration_number || '',
        location_base_port: boat.location_base_port || 'Ibiza Town',
        features: boat.features || [],
        owner_id: boat.owner_id || '',
        photo_urls: boat.photo_urls || '',
        ses_establishment_code: boat.ses_establishment_code || '',
    });
    const [newFeature, setNewFeature] = useState('');
    const [seasonalRates, setSeasonalRates] = useState([]);
    const [loadingRates, setLoadingRates] = useState(false);
    const [showRateForm, setShowRateForm] = useState(false);
    const [newRate, setNewRate] = useState({
        start_date: '',
        end_date: '',
        amount: 0,
        minimum_nights: 1,
        allowed_checkin_days: 'Flexible check in days'
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (role === 'admin' || role === 'super_admin' || role === 'editor') {
            fetchOwners();
        }
        if (boat.v_uuid) {
            fetchSeasonalRates();
        }
    }, [role, boat.v_uuid]);

    const fetchSeasonalRates = async () => {
        setLoadingRates(true);
        const { data, error } = await supabase
            .from('invenio_seasonal_prices')
            .select('*')
            .eq('v_uuid', boat.v_uuid)
            .order('start_date', { ascending: true });
        
        if (!error && data) {
            setSeasonalRates(data);
        }
        setLoadingRates(false);
    };

    const handleAddRate = async () => {
        if (!newRate.start_date || !newRate.end_date || !newRate.amount) {
            return alert('Please fill in start date, end date and amount');
        }

        const { data, error } = await supabase
            .from('invenio_seasonal_prices')
            .insert([{
                ...newRate,
                v_uuid: boat.v_uuid,
                amount: parseFloat(newRate.amount),
                minimum_nights: parseInt(newRate.minimum_nights)
            }])
            .select()
            .single();

        if (error) {
            alert('Error adding rate: ' + error.message);
        } else {
            setSeasonalRates(prev => [...prev, data].sort((a, b) => new Date(a.start_date) - new Date(b.start_date)));
            setShowRateForm(false);
            setNewRate({
                start_date: '',
                end_date: '',
                amount: 0,
                minimum_nights: 1,
                allowed_checkin_days: 'Flexible check in days'
            });
        }
    };

    const handleDeleteRate = async (id) => {
        if (!window.confirm('Are you sure you want to delete this seasonal rate?')) return;

        const { error } = await supabase
            .from('invenio_seasonal_prices')
            .delete()
            .eq('id', id);

        if (error) {
            alert('Error deleting rate: ' + error.message);
        } else {
            setSeasonalRates(prev => prev.filter(r => r.id !== id));
        }
    };

    const fetchOwners = async () => {
        const { data, error } = await supabase
            .from('owners')
            .select('id, name')
            .eq('is_active', true)
            .order('name');
        
        if (!error && data) {
            setOwners(data);
        }
    };

    const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            const boatData = {
                ...form,
                year: parseInt(form.year) || 0,
                length_ft: parseFloat(form.length_ft) || 0,
                beam_ft: parseFloat(form.beam_ft) || 0,
                draft_ft: parseFloat(form.draft_ft) || 0,
                guest_capacity_day: parseInt(form.guest_capacity_day) || 0,
                guest_capacity_overnight: parseInt(form.guest_capacity_overnight) || 0,
                cabins: parseInt(form.cabins) || 0,
                bathrooms: parseInt(form.bathrooms) || 0,
                daily_price: parseFloat(form.daily_price) || 0,
                weekly_price: parseFloat(form.weekly_price) || 0,
                security_deposit: parseFloat(form.security_deposit) || 0,
                cleaning_fee: parseFloat(form.cleaning_fee) || 0,
                owner_id: form.owner_id || null,
            };

            let result;
            if (boat.v_uuid) {
                result = await supabase
                    .from('invenio_boats')
                    .update(boatData)
                    .eq('v_uuid', boat.v_uuid)
                    .select()
                    .single();
            } else {
                result = await supabase
                    .from('invenio_boats')
                    .insert([boatData])
                    .select()
                    .single();
            }

            if (result.error) throw result.error;
            onSaved(result.data);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="bg-surface border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
                {/* Header */}
                <div className="flex items-center gap-4 p-6 border-b border-border">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-surface-2 border border-border flex-shrink-0">
                        <img 
                            src={form.thumbnail_url || 'https://images.unsplash.com/photo-1567899534071-723d01397ad0?auto=format&fit=crop&w=400&q=60'} 
                            className="w-full h-full object-cover" 
                            alt="" 
                        />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-lg font-bold text-text-primary truncate">{boat.v_uuid ? 'Edit Boat' : 'Add New Boat'}</h2>
                        <p className="text-xs text-text-muted mt-0.5 truncate">{form.boat_name || 'New Vessel'}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-lg transition-colors"
                    >
                        <span className="material-symbols-outlined notranslate">close</span>
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    {/* Basic Info */}
                    <section>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-4 flex items-center gap-2">
                             <span className="material-symbols-outlined notranslate text-sm">info</span>
                             Identity & Specs
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Boat Name" field="boat_name" form={form} handleChange={handleChange} fullWidth />
                            <Field label="Manufacturer" field="manufacturer" form={form} handleChange={handleChange} />
                            <Field label="Model" field="model" form={form} handleChange={handleChange} />
                            <div className="grid grid-cols-2 gap-4 col-span-2">
                                <Field label="Year" field="year" type="number" form={form} handleChange={handleChange} />
                                <div>
                                    <label className="block text-xs text-text-muted mb-1.5 font-medium">Boat Type</label>
                                    <select 
                                        className="input-theme w-full"
                                        value={form.type}
                                        onChange={e => handleChange('type', e.target.value)}
                                    >
                                        <option value="Motor">Motor</option>
                                        <option value="Sail">Sail</option>
                                        <option value="Catamaran">Catamaran</option>
                                        <option value="Superyacht">Superyacht</option>
                                    </select>
                                </div>
                            </div>
                            <Field label="Thumbnail URL" field="thumbnail_url" form={form} handleChange={handleChange} fullWidth />
                             <Field 
                                 label="Gallery Photo URLs (comma separated)" 
                                 field="photo_urls" 
                                 form={form} 
                                 handleChange={handleChange} 
                                 type="textarea"
                                 fullWidth 
                                 placeholder="https://image1.jpg, https://image2.jpg..."
                             />
                        </div>
                    </section>

                    {/* Dimensions & Capacity */}
                    <section>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-4 flex items-center gap-2">
                             <span className="material-symbols-outlined notranslate text-sm">straighten</span>
                             Dimensions & Capacity
                        </p>
                        <div className="grid grid-cols-3 gap-4">
                            <Field label="Length (ft)" field="length_ft" type="number" form={form} handleChange={handleChange} />
                            <Field label="Beam (ft)" field="beam_ft" type="number" form={form} handleChange={handleChange} />
                            <Field label="Draft (ft)" field="draft_ft" type="number" form={form} handleChange={handleChange} />
                            
                            <Field label="Pax (Day)" field="guest_capacity_day" type="number" form={form} handleChange={handleChange} />
                            <Field label="Pax (Sleeps)" field="guest_capacity_overnight" type="number" form={form} handleChange={handleChange} />
                            <Field label="Cabins" field="cabins" type="number" form={form} handleChange={handleChange} />
                            
                            <Field label="Bathrooms" field="bathrooms" type="number" form={form} handleChange={handleChange} />
                        </div>
                    </section>

                    {/* Pricing */}
                    <section>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-4 flex items-center gap-2">
                             <span className="material-symbols-outlined notranslate text-sm">payments</span>
                             Pricing & Policy
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Daily Price (€)" field="daily_price" type="number" form={form} handleChange={handleChange} />
                            <Field label="Weekly Price (€)" field="weekly_price" type="number" form={form} handleChange={handleChange} />
                            <Field label="Security Deposit (€)" field="security_deposit" type="number" form={form} handleChange={handleChange} />
                            <Field label="Cleaning Fee (€)" field="cleaning_fee" type="number" form={form} handleChange={handleChange} />
                            
                            <div>
                                <label className="block text-xs text-text-muted mb-1.5 font-medium">Fuel Policy</label>
                                <select 
                                    className="input-theme w-full"
                                    value={form.fuel_policy}
                                    onChange={e => handleChange('fuel_policy', e.target.value)}
                                >
                                    <option value="Paid by Consumption">Paid by Consumption</option>
                                    <option value="Full to Full">Full to Full</option>
                                    <option value="Included">Included</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-text-muted mb-1.5 font-medium">Skipper</label>
                                <select 
                                    className="input-theme w-full"
                                    value={form.skipper_type}
                                    onChange={e => handleChange('skipper_type', e.target.value)}
                                >
                                    <option value="Required">Required</option>
                                    <option value="Optional">Optional</option>
                                    <option value="Bareboat">Bareboat (No Skipper)</option>
                                </select>
                            </div>
                        </div>
                    </section>

                    {/* Seasonal Pricing */}
                    {boat.v_uuid && (
                        <section>
                            <div className="flex items-center justify-between mb-4">
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary flex items-center gap-2">
                                    <span className="material-symbols-outlined notranslate text-sm">calendar_month</span>
                                    Seasonal Pricing (Daily)
                                </p>
                                <button 
                                    onClick={() => setShowRateForm(!showRateForm)}
                                    className="text-[10px] font-bold text-primary uppercase hover:underline flex items-center gap-1"
                                >
                                    <span className="material-symbols-outlined notranslate text-sm">{showRateForm ? 'close' : 'add'}</span>
                                    {showRateForm ? 'Cancel' : 'Add Seasonal Rate'}
                                </button>
                            </div>

                            {showRateForm && (
                                <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl mb-6 space-y-4 animate-in slide-in-from-top-2">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase">Start Date</label>
                                            <input 
                                                type="date"
                                                className="input-theme w-full text-sm"
                                                value={newRate.start_date}
                                                onChange={e => setNewRate(p => ({ ...p, start_date: e.target.value }))}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase">End Date</label>
                                            <input 
                                                type="date"
                                                className="input-theme w-full text-sm"
                                                value={newRate.end_date}
                                                onChange={e => setNewRate(p => ({ ...p, end_date: e.target.value }))}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase">Daily Amount (€)</label>
                                            <input 
                                                type="number"
                                                className="input-theme w-full text-sm"
                                                placeholder="0.00"
                                                value={newRate.amount}
                                                onChange={e => setNewRate(p => ({ ...p, amount: e.target.value }))}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase">Min Days</label>
                                            <input 
                                                type="number"
                                                className="input-theme w-full text-sm"
                                                value={newRate.minimum_nights}
                                                onChange={e => setNewRate(p => ({ ...p, minimum_nights: e.target.value }))}
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase">Allowed Check-in</label>
                                            <select 
                                                className="input-theme w-full text-sm"
                                                value={newRate.allowed_checkin_days}
                                                onChange={e => setNewRate(p => ({ ...p, allowed_checkin_days: e.target.value }))}
                                            >
                                                <option value="Flexible check in days">Flexible</option>
                                                <option value="Strictly Saturday-Saturday">Strictly Saturday-Saturday</option>
                                            </select>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={handleAddRate}
                                        className="w-full btn-primary py-2 text-xs font-bold"
                                    >
                                        Save Seasonal Rate
                                    </button>
                                </div>
                            )}

                            <div className="space-y-2">
                                {loadingRates ? (
                                    <p className="text-[10px] text-text-muted italic">Loading rates...</p>
                                ) : seasonalRates.length > 0 ? (
                                    <div className="border border-border rounded-xl overflow-hidden">
                                        <table className="w-full text-left text-[11px]">
                                            <thead className="bg-surface-2 text-text-muted uppercase font-bold">
                                                <tr>
                                                    <th className="px-4 py-2">Dates</th>
                                                    <th className="px-4 py-2">Price</th>
                                                    <th className="px-4 py-2">MinD/Checkin</th>
                                                    <th className="px-4 py-2"></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border">
                                                {seasonalRates.map(r => (
                                                    <tr key={r.id} className="hover:bg-surface-2/50 transition-colors">
                                                        <td className="px-4 py-3 font-medium">
                                                            {new Date(r.start_date).toLocaleDateString()} - {new Date(r.end_date).toLocaleDateString()}
                                                        </td>
                                                        <td className="px-4 py-3 font-bold text-primary">€{r.amount.toLocaleString()}</td>
                                                        <td className="px-4 py-3 text-text-muted">
                                                            {r.minimum_nights}d / {r.allowed_checkin_days === 'Flexible check in days' ? 'Flex' : 'Sat'}
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            <button 
                                                                onClick={() => handleDeleteRate(r.id)}
                                                                className="text-text-muted hover:text-red-400 transition-colors"
                                                            >
                                                                <span className="material-symbols-outlined notranslate text-sm">delete</span>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <p className="text-[10px] text-text-muted italic bg-surface-2 p-4 rounded-xl border border-dashed border-border text-center">
                                        No seasonal rates defined. Default daily price will be used.
                                    </p>
                                )}
                            </div>
                        </section>
                    )}

                    {/* Legal & Location */}
                    <section>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-4 flex items-center gap-2">
                             <span className="material-symbols-outlined notranslate text-sm">gavel</span>
                             Legal & Port
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Registration / License" field="registration_number" form={form} handleChange={handleChange} />
                            <Field label="Base Port" field="location_base_port" form={form} handleChange={handleChange} />
                            <Field label="SES Establishment Code" field="ses_establishment_code" form={form} handleChange={handleChange} />
                            {(role === 'admin' || role === 'super_admin' || role === 'editor') && (
                                <div className="col-span-2">
                                    <label className="block text-xs text-text-muted mb-1.5 font-medium">Yacht Owner</label>
                                    <select 
                                        className="input-theme w-full"
                                        value={form.owner_id}
                                        onChange={e => handleChange('owner_id', e.target.value)}
                                    >
                                        <option value="">Select Owner...</option>
                                        {owners.map(o => (
                                            <option key={o.id} value={o.id}>{o.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    </section>

                    {/* Features */}
                    <section>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-4 flex items-center gap-2">
                             <span className="material-symbols-outlined notranslate text-sm">featured_play_list</span>
                             Features
                        </p>
                        <div className="flex flex-wrap gap-2 mb-3">
                            {form.features.map(f => (
                                <span key={f} className="flex items-center gap-1.5 px-3 py-1 bg-primary/10 border border-primary/20 rounded-full text-[11px] font-bold text-primary">
                                    {f}
                                    <button 
                                        onClick={() => handleChange('features', form.features.filter(x => x !== f))}
                                        className="hover:text-text-primary"
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
                                placeholder="Add feature (e.g. WiFi, Tender, Seabob...)"
                                value={newFeature}
                                onChange={e => setNewFeature(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && newFeature.trim()) {
                                        if (!form.features.includes(newFeature.trim())) {
                                            handleChange('features', [...form.features, newFeature.trim()]);
                                        }
                                        setNewFeature('');
                                    }
                                }}
                            />
                            <button 
                                onClick={() => {
                                    if (newFeature.trim() && !form.features.includes(newFeature.trim())) {
                                        handleChange('features', [...form.features, newFeature.trim()]);
                                        setNewFeature('');
                                    }
                                }}
                                className="size-10 flex items-center justify-center bg-primary/20 text-primary border border-primary/30 rounded-lg hover:bg-primary/30 transition-all"
                            >
                                <span className="material-symbols-outlined notranslate">add</span>
                            </button>
                        </div>
                    </section>

                    {/* Description */}
                    <section>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-4 flex items-center gap-2">
                             <span className="material-symbols-outlined notranslate text-sm">description</span>
                             Description
                        </p>
                        <Field label="Tagline" field="tagline" form={form} handleChange={handleChange} fullWidth />
                        <div className="mt-4">
                            <Field label="Detailed Description" field="description" type="textarea" form={form} handleChange={handleChange} fullWidth />
                        </div>
                    </section>
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-border flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="btn-primary text-sm disabled:opacity-50 flex items-center gap-2"
                    >
                        <span className="material-symbols-outlined notranslate text-[16px]">{saving ? 'hourglass_empty' : 'save'}</span>
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
}
