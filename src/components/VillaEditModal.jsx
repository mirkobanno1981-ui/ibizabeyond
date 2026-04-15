import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const Field = ({ label, field, form, handleChange, type = 'text', fullWidth = false }) => (
    <div className={fullWidth ? 'col-span-2' : ''}>
        <label className="block text-xs text-text-muted mb-1.5 font-medium">{label}</label>
        {type === 'textarea' ? (
            <textarea
                className="input-theme w-full resize-none"
                rows={3}
                value={form[field]}
                onChange={e => handleChange(field, e.target.value)}
            />
        ) : (
            <input
                type={type}
                className="input-theme w-full"
                value={form[field]}
                onChange={e => handleChange(field, e.target.value)}
            />
        )}
    </div>
);

export default function VillaEditModal({ villa, onClose, onSaved }) {
    const { role, user } = useAuth();
    const [owners, setOwners] = useState([]);
    const [form, setForm] = useState({
        villa_name: villa.villa_name || '',
        areaname: villa.areaname || '',
        district: villa.district || '',
        bedrooms: villa.bedrooms || 0,
        bathrooms: villa.bathrooms || 0,
        sleeps: villa.sleeps || 0,
        minimum_price: villa.minimum_price || 0,
        maximum_price: villa.maximum_price || 0,
        cleaning_charge: villa.cleaning_charge || 0,
        tagline: villa.tagline || '',
        description: villa.description || '',
        ical_url: villa.ical_url || '',
        allow_shortstays: villa.allow_shortstays || 'no',
        minimum_nights: villa.minimum_nights || 7,
        allowed_checkin_days: villa.allowed_checkin_days || 'Flexible check in days',
        thumbnail_url: villa.thumbnail_url || '',
        license: villa.license || '',
        gps: villa.gps || '',
        deposit: villa.deposit || 0,
        features: villa.features || [],
        owner_id: villa.owner_id || '',
        ses_establishment_code: villa.ses_establishment_code || '',
    });
    const [newFeature, setNewFeature] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (role === 'admin' || role === 'super_admin' || role === 'editor') {
            fetchOwners();
        }
    }, [role]);

    const fetchOwners = async () => {
        try {
            let query = supabase
                .from('owners')
                .select('id, name')
                .eq('is_active', true);
            
            if (role === 'agent') {
                // Get agent profile id
                const { data: agentData } = await supabase
                    .from('agents')
                    .select('id')
                    .eq('user_id', user.id)
                    .single();
                
                if (agentData) {
                    query = query.eq('agent_id', agentData.id);
                } else {
                    setOwners([]);
                    return;
                }
            }

            const { data, error } = await query.order('name');
            
            if (!error && data) {
                setOwners(data);
            }
        } catch (err) {
            console.error("Fetch owners error:", err);
        }
    };

    const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            if (!form.license || form.license.trim() === '') {
                throw new Error('Tourist license number is mandatory according to Balearic regulations.');
            }

            const villaData = {
                villa_name: form.villa_name,
                areaname: form.areaname,
                district: form.district,
                bedrooms: parseInt(form.bedrooms) || 0,
                bathrooms: parseFloat(form.bathrooms) || 0,
                sleeps: parseInt(form.sleeps) || 0,
                minimum_price: parseFloat(form.minimum_price) || 0,
                maximum_price: parseFloat(form.maximum_price) || 0,
                cleaning_charge: parseFloat(form.cleaning_charge) || 0,
                tagline: form.tagline,
                description: form.description,
                ical_url: form.ical_url,
                allow_shortstays: form.allow_shortstays,
                minimum_nights: parseInt(form.minimum_nights) || 7,
                allowed_checkin_days: form.allowed_checkin_days,
                thumbnail_url: form.thumbnail_url,
                license: form.license,
                gps: form.gps,
                deposit: parseFloat(form.deposit) || 0,
                features: form.features,
                owner_id: role === 'owner' ? user.id : (form.owner_id || null),
                ses_establishment_code: form.ses_establishment_code,
                created_by: villa.v_uuid ? villa.created_by : user.id
            };

            let result;
            if (villa.v_uuid) {
                result = await supabase
                    .from('invenio_properties')
                    .update(villaData)
                    .eq('v_uuid', villa.v_uuid)
                    .select()
                    .single();
            } else {
                result = await supabase
                    .from('invenio_properties')
                    .insert([villaData])
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
                            src={form.thumbnail_url || 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=400&q=60'} 
                            className="w-full h-full object-cover" 
                            alt="" 
                        />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-lg font-bold text-text-primary truncate">{villa.v_uuid ? 'Edit Villa' : 'Add New Villa'}</h2>
                        <p className="text-xs text-text-muted mt-0.5 truncate">{form.villa_name || 'Unnamed Property'}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-lg transition-colors"
                    >
                        <span className="material-symbols-outlined notranslate">close</span>
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    {/* Identità */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Identity & Content</p>
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Villa Name" field="villa_name" form={form} handleChange={handleChange} fullWidth />
                            <Field label="Tagline" field="tagline" form={form} handleChange={handleChange} fullWidth />
                            <Field label="Main Photo URL" field="thumbnail_url" form={form} handleChange={handleChange} fullWidth />
                            <Field label="License Number" field="license" form={form} handleChange={handleChange} />
                            <Field label="GPS Coordinates" field="gps" form={form} handleChange={handleChange} />
                            {(role === 'admin' || role === 'super_admin' || role === 'editor') && (
                                <div className="col-span-2">
                                    <label className="block text-xs text-text-muted mb-1.5 font-medium">
                                        {role === 'agent' ? 'Associated Owner (Contact)' : 'Villa Owner'}
                                    </label>
                                    <select 
                                        className="input-theme w-full"
                                        value={form.owner_id}
                                        onChange={e => handleChange('owner_id', e.target.value)}
                                        required={role === 'agent'}
                                    >
                                        <option value="">Select Owner...</option>
                                        {owners.map(o => (
                                            <option key={o.id} value={o.id}>{o.name}</option>
                                        ))}
                                    </select>
                                    <p className="text-[10px] text-text-muted mt-2 italic">
                                        {role === 'agent' 
                                            ? 'You can only select owners that you manage as direct contacts.'
                                            : 'Note: Owners must be registered as users in the management section first.'}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Location */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Location</p>
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Area Name" field="areaname" form={form} handleChange={handleChange} />
                            <Field label="District" field="district" form={form} handleChange={handleChange} />
                        </div>
                    </div>

                    {/* Capacity */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Capacity</p>
                        <div className="grid grid-cols-3 gap-4">
                            <Field label="Bedrooms" field="bedrooms" type="number" form={form} handleChange={handleChange} />
                            <Field label="Bathrooms" field="bathrooms" type="number" form={form} handleChange={handleChange} />
                            <Field label="Sleeps" field="sleeps" type="number" form={form} handleChange={handleChange} />
                        </div>
                    </div>

                    {/* Pricing */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Pricing & Deposit (€)</p>
                        <div className="grid grid-cols-4 gap-4">
                            <Field label="Min Price" field="minimum_price" type="number" form={form} handleChange={handleChange} />
                            <Field label="Max Price" field="maximum_price" type="number" form={form} handleChange={handleChange} />
                            <Field label="Cleaning" field="cleaning_charge" type="number" form={form} handleChange={handleChange} />
                            <Field label="Deposit" field="deposit" type="number" form={form} handleChange={handleChange} />
                        </div>
                    </div>

                    {/* Booking Policies */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Booking Policies</p>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs text-text-muted mb-1.5 font-medium">Allow Short Stays</label>
                                <select 
                                    className="input-theme w-full"
                                    value={form.allow_shortstays}
                                    onChange={e => handleChange('allow_shortstays', e.target.value)}
                                >
                                    <option value="no">No</option>
                                    <option value="yes">Yes</option>
                                </select>
                            </div>
                            <Field label="Minimum Nights" field="minimum_nights" type="number" form={form} handleChange={handleChange} />
                            <div>
                                <label className="block text-xs text-text-muted mb-1.5 font-medium">Check-in Days</label>
                                <select 
                                    className="input-theme w-full"
                                    value={form.allowed_checkin_days}
                                    onChange={e => handleChange('allowed_checkin_days', e.target.value)}
                                >
                                    <option value="Flexible check in days">Flexible</option>
                                    <option value="Strictly Saturday-Saturday">Strictly Sat-Sat</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Technical */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Technical & API</p>
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="iCal Availability URL" field="ical_url" form={form} handleChange={handleChange} fullWidth />
                            <Field label="SES Establishment Code" field="ses_establishment_code" form={form} handleChange={handleChange} />
                            <div className="flex items-center text-[10px] text-text-muted italic pt-6">
                                Required for Ministry police reporting.
                            </div>
                        </div>
                    </div>

                    {/* Features */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Features & Amenities</p>
                        <div className="flex flex-wrap gap-2 mb-3">
                            {form.features.map(f => (
                                <span key={f} className="flex items-center gap-1.5 px-3 py-1 bg-primary/10 border border-primary/20 rounded-full text-[11px] font-bold text-primary animate-in zoom-in duration-200">
                                    {f}
                                    <button 
                                        onClick={() => handleChange('features', form.features.filter(x => x !== f))}
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
                                placeholder="Add feature (e.g. Infinity Pool, Gym...)"
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
                    </div>

                    {/* Description */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Description</p>
                        <div className="grid grid-cols-1 gap-4">
                            <Field label="Detailed Description" field="description" type="textarea" form={form} handleChange={handleChange} fullWidth />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-border flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary hover:border-primary/30 transition-all"
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
