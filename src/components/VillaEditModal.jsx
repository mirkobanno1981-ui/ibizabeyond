import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function VillaEditModal({ villa, onClose, onSaved }) {
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
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            const { error: saveError } = await supabase
                .from('invenio_properties')
                .update({
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
                })
                .eq('v_uuid', villa.v_uuid);

            if (saveError) throw saveError;
            onSaved({ ...villa, ...form });
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const Field = ({ label, field, type = 'text', fullWidth = false }) => (
        <div className={fullWidth ? 'col-span-2' : ''}>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">{label}</label>
            {type === 'textarea' ? (
                <textarea
                    className="input-dark w-full resize-none"
                    rows={3}
                    value={form[field]}
                    onChange={e => handleChange(field, e.target.value)}
                />
            ) : (
                <input
                    type={type}
                    className="input-dark w-full"
                    value={form[field]}
                    onChange={e => handleChange(field, e.target.value)}
                />
            )}
        </div>
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="bg-surface-dark border border-border-dark rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
                {/* Header */}
                <div className="flex items-center gap-4 p-6 border-b border-border-dark">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-surface-dark2 border border-border-dark flex-shrink-0">
                        <img 
                            src={villa.thumbnail || 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=400&q=60'} 
                            className="w-full h-full object-cover" 
                            alt="" 
                        />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-lg font-bold text-white truncate">Edit {villa.villa_name || 'Villa'}</h2>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{villa.v_uuid}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                    >
                        <span className="material-symbols-outlined">close</span>
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
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Identity</p>
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Villa Name" field="villa_name" fullWidth />
                            <Field label="Tagline" field="tagline" fullWidth />
                        </div>
                    </div>

                    {/* Location */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Location</p>
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Area Name" field="areaname" />
                            <Field label="District" field="district" />
                        </div>
                    </div>

                    {/* Capacity */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Capacity</p>
                        <div className="grid grid-cols-3 gap-4">
                            <Field label="Bedrooms" field="bedrooms" type="number" />
                            <Field label="Bathrooms" field="bathrooms" type="number" />
                            <Field label="Sleeps" field="sleeps" type="number" />
                        </div>
                    </div>

                    {/* Pricing */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Pricing (€)</p>
                        <div className="grid grid-cols-3 gap-4">
                            <Field label="Min Price" field="minimum_price" type="number" />
                            <Field label="Max Price" field="maximum_price" type="number" />
                            <Field label="Cleaning" field="cleaning_charge" type="number" />
                        </div>
                    </div>

                    {/* Description */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Description</p>
                        <div className="grid grid-cols-1 gap-4">
                            <Field label="Description" field="description" type="textarea" fullWidth />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-border-dark flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 rounded-lg border border-border-dark text-sm text-slate-400 hover:text-white hover:border-primary/30 transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="btn-primary text-sm disabled:opacity-50 flex items-center gap-2"
                    >
                        <span className="material-symbols-outlined text-[16px]">{saving ? 'hourglass_empty' : 'save'}</span>
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
}
