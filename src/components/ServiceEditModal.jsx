import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function ServiceEditModal({ service, categories, onClose, onSaved }) {
    const { user } = useAuth();
    const isNew = !service?.id;

    const [form, setForm] = useState({
        name: '',
        category_id: '',
        provider: '',
        description: '',
        price: '',
        currency: 'EUR',
        price_unit: 'session',
        photo_url: '',
        contact_phone: '',
        contact_email: '',
        contact_website: '',
        is_active: true,
    });

    const [showAddCategory, setShowAddCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategoryIcon, setNewCategoryIcon] = useState('concierge');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (service?.id) {
            setForm({
                name: service.name || '',
                category_id: service.category_id || '',
                provider: service.provider || '',
                description: service.description || '',
                price: service.price ?? '',
                currency: service.currency || 'EUR',
                price_unit: service.price_unit || 'session',
                photo_url: service.photo_url || '',
                contact_phone: service.contact_phone || '',
                contact_email: service.contact_email || '',
                contact_website: service.contact_website || '',
                is_active: service.is_active !== false,
            });
        }
    }, [service]);

    const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const handleAddCategory = async () => {
        if (!newCategoryName.trim()) return;
        const { data, error: err } = await supabase
            .from('service_categories')
            .insert({ name: newCategoryName.trim(), icon: newCategoryIcon || 'concierge' })
            .select()
            .single();
        if (err) { setError(err.message); return; }
        update('category_id', data.id);
        setNewCategoryName('');
        setNewCategoryIcon('concierge');
        setShowAddCategory(false);
        if (onSaved) {
            // refetch happens via parent invalidate after save; signal local refresh by mutating categories prop is not possible
            // parent will refresh after the actual service save; for now reload the page-level query is enough on close
        }
    };

    const handleSave = async () => {
        setError('');
        if (!form.name.trim()) { setError('Name is required.'); return; }

        setSaving(true);
        const payload = {
            name: form.name.trim(),
            category_id: form.category_id || null,
            provider: form.provider || null,
            description: form.description || null,
            price: form.price === '' ? null : Number(form.price),
            currency: form.currency || 'EUR',
            price_unit: form.price_unit || 'session',
            photo_url: form.photo_url || null,
            contact_phone: form.contact_phone || null,
            contact_email: form.contact_email || null,
            contact_website: form.contact_website || null,
            is_active: form.is_active,
        };

        let res;
        if (isNew) {
            payload.created_by = user?.id || null;
            res = await supabase.from('services').insert(payload).select().single();
        } else {
            res = await supabase.from('services').update(payload).eq('id', service.id).select().single();
        }

        setSaving(false);
        if (res.error) { setError(res.error.message); return; }
        onSaved && onSaved();
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-2xl my-8">
                <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-text-primary">
                            {isNew ? 'Add Service' : 'Edit Service'}
                        </h2>
                        <p className="text-xs text-text-muted mt-0.5">Catalog entry visible to all authenticated users.</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                        <span className="material-symbols-outlined notranslate text-text-muted">close</span>
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    {error && (
                        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] block mb-1.5">Service Name *</label>
                            <input
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary"
                                value={form.name}
                                onChange={e => update('name', e.target.value)}
                                placeholder="e.g. Premium hair styling at villa"
                            />
                        </div>

                        <div className="md:col-span-2">
                            <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] block mb-1.5">Category</label>
                            <div className="flex gap-2">
                                <select
                                    className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm outline-none cursor-pointer"
                                    value={form.category_id}
                                    onChange={e => update('category_id', e.target.value)}
                                >
                                    <option value="">Uncategorized</option>
                                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                                <button
                                    type="button"
                                    onClick={() => setShowAddCategory(s => !s)}
                                    className="px-3 py-3 rounded-xl bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors flex items-center gap-1"
                                >
                                    <span className="material-symbols-outlined notranslate text-[16px]">add</span>
                                    New
                                </button>
                            </div>
                            {showAddCategory && (
                                <div className="mt-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2">
                                    <div className="flex gap-2">
                                        <input
                                            className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm outline-none"
                                            placeholder="Category name"
                                            value={newCategoryName}
                                            onChange={e => setNewCategoryName(e.target.value)}
                                        />
                                        <input
                                            className="w-36 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm outline-none"
                                            placeholder="Icon (optional)"
                                            value={newCategoryIcon}
                                            onChange={e => setNewCategoryIcon(e.target.value)}
                                        />
                                        <button
                                            type="button"
                                            onClick={handleAddCategory}
                                            className="px-4 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90"
                                        >
                                            Save
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-text-muted">Icon name from Material Symbols (e.g. <code>spa</code>, <code>content_cut</code>). Leave default for generic.</p>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] block mb-1.5">Provider</label>
                            <input
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm outline-none"
                                value={form.provider}
                                onChange={e => update('provider', e.target.value)}
                                placeholder="Business / professional name"
                            />
                        </div>

                        <div>
                            <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] block mb-1.5">Photo URL</label>
                            <input
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm outline-none"
                                value={form.photo_url}
                                onChange={e => update('photo_url', e.target.value)}
                                placeholder="https://..."
                            />
                        </div>

                        <div className="md:col-span-2">
                            <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] block mb-1.5">Description</label>
                            <textarea
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm outline-none min-h-[80px]"
                                value={form.description}
                                onChange={e => update('description', e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] block mb-1.5">Price</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm outline-none"
                                value={form.price}
                                onChange={e => update('price', e.target.value)}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] block mb-1.5">Currency</label>
                                <select
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm outline-none"
                                    value={form.currency}
                                    onChange={e => update('currency', e.target.value)}
                                >
                                    <option>EUR</option>
                                    <option>USD</option>
                                    <option>GBP</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] block mb-1.5">Unit</label>
                                <select
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm outline-none"
                                    value={form.price_unit}
                                    onChange={e => update('price_unit', e.target.value)}
                                >
                                    <option value="session">session</option>
                                    <option value="hour">hour</option>
                                    <option value="day">day</option>
                                    <option value="person">person</option>
                                    <option value="package">package</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] block mb-1.5">Phone</label>
                            <input
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm outline-none"
                                value={form.contact_phone}
                                onChange={e => update('contact_phone', e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] block mb-1.5">Email</label>
                            <input
                                type="email"
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm outline-none"
                                value={form.contact_email}
                                onChange={e => update('contact_email', e.target.value)}
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] block mb-1.5">Website</label>
                            <input
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm outline-none"
                                value={form.contact_website}
                                onChange={e => update('contact_website', e.target.value)}
                                placeholder="https://..."
                            />
                        </div>

                        <div className="md:col-span-2 flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                            <div>
                                <p className="text-sm font-semibold">Active</p>
                                <p className="text-[10px] text-text-muted">Inactive services hidden from non-admins.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => update('is_active', !form.is_active)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.is_active ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-700'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-100 dark:border-slate-800">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-text-secondary hover:bg-slate-200"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
                    >
                        <span className="material-symbols-outlined notranslate text-[16px]">save</span>
                        {saving ? 'Saving...' : 'Save Service'}
                    </button>
                </div>
            </div>
        </div>
    );
}
