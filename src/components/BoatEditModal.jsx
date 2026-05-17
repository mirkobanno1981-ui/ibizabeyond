import React, { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import EntityVisibilityTab from './EntityVisibilityTab';
import { resizeImagesIfNeeded } from '../lib/imageResize';
import { extractPhotosFromPdf } from '../lib/pdfPhotoExtract';
import SeasonalPricingCalendar from './SeasonalPricingCalendar';
import AiEditOverlay from './AiEditOverlay';
import { requestBoatAiPatch } from '../lib/boatAiEditApi';

const PHOTO_ACCEPT = {
    'image/jpeg': [], 'image/png': [], 'image/webp': [], 'application/pdf': [],
};

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
    const { role, user, canAdd } = useAuth();
    const isAdmin = role === 'admin' || role === 'super_admin';
    const canAddBoats = isAdmin || canAdd('boat');
    const [owners, setOwners] = useState([]);
    const [captatorAgent, setCaptatorAgent] = useState(null);
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
        price_locked: !!boat.price_locked,
        ical_url: boat.ical_url || '',
        editor_commission_pct: boat.editor_commission_pct ?? 5,
        editor_commission_included: boat.editor_commission_included !== false,
    });
    const [newFeature, setNewFeature] = useState('');
    const [seasonalRates, setSeasonalRates] = useState([]);
    const [pendingRates, setPendingRates] = useState([]);
    const [loadingRates, setLoadingRates] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('details');
    const [pendingPhotos, setPendingPhotos] = useState([]); // [{ id, file, previewUrl, sourcePdf }]
    const [existingPhotos, setExistingPhotos] = useState([]); // [{ id, url, thumbnail_url, sort_order, storage_path }]
    const [extractingPdf, setExtractingPdf] = useState(false);
    const [showAiEdit, setShowAiEdit] = useState(false);

    useEffect(() => {
        if (canAddBoats || role === 'agent') {
            fetchOwners();
        }
        if (boat.v_uuid) {
            fetchSeasonalRates();
            fetchExistingPhotos();
        }
    }, [role, boat.v_uuid]);

    useEffect(() => () => {
        pendingPhotos.forEach(p => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    }, []); // eslint-disable-line

    const fetchExistingPhotos = async () => {
        const { data, error: pErr } = await supabase
            .from('property_photos')
            .select('id, url, thumbnail_url, sort_order, storage_path, caption')
            .eq('boat_uuid', boat.v_uuid)
            .order('sort_order', { ascending: true });
        if (!pErr && data) setExistingPhotos(data);
    };

    const onDropPhotos = useCallback(async (accepted) => {
        const pdfs = accepted.filter(f => f.type === 'application/pdf');
        const images = accepted.filter(f => f.type.startsWith('image/'));

        const next = images.map(f => ({
            id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            file: f,
            previewUrl: URL.createObjectURL(f),
            sourcePdf: null,
        }));
        setPendingPhotos(prev => [...prev, ...next]);

        if (pdfs.length) {
            setExtractingPdf(true);
            try {
                for (const pdf of pdfs) {
                    const photos = await extractPhotosFromPdf(pdf);
                    if (photos.length) {
                        const extracted = photos.map(f => ({
                            id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                            file: f,
                            previewUrl: URL.createObjectURL(f),
                            sourcePdf: pdf.name,
                        }));
                        setPendingPhotos(prev => [...prev, ...extracted]);
                    }
                }
            } catch (e) {
                console.warn('PDF extraction failed', e);
            } finally {
                setExtractingPdf(false);
            }
        }
    }, []);

    const { getRootProps: getPhotoRootProps, getInputProps: getPhotoInputProps, isDragActive: isPhotoDragActive } = useDropzone({
        onDrop: onDropPhotos,
        accept: PHOTO_ACCEPT,
        multiple: true,
    });

    const removePending = id => {
        setPendingPhotos(prev => {
            const target = prev.find(p => p.id === id);
            if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
            return prev.filter(p => p.id !== id);
        });
    };

    const deleteExistingPhoto = async (photo) => {
        if (!window.confirm('Delete this photo permanently?')) return;
        if (photo.storage_path) {
            await supabase.storage.from('boat-photos').remove([photo.storage_path]).catch(() => {});
        }
        const { error: dErr } = await supabase.from('property_photos').delete().eq('id', photo.id);
        if (dErr) {
            setError(`Photo delete failed: ${dErr.message}`);
            return;
        }
        setExistingPhotos(prev => prev.filter(p => p.id !== photo.id));
    };

    const uploadPendingPhotos = async (boatUuid) => {
        if (!pendingPhotos.length) return;
        const files = pendingPhotos.map(p => p.file);
        const resized = await resizeImagesIfNeeded(files, { maxEdge: 1920, quality: 0.88 });
        const baseSort = (existingPhotos[existingPhotos.length - 1]?.sort_order ?? -1) + 1;
        for (let i = 0; i < resized.length; i++) {
            const f = resized[i];
            const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
            const destPath = `${boatUuid}/${crypto.randomUUID()}.${ext}`;
            const { error: upErr } = await supabase.storage
                .from('boat-photos')
                .upload(destPath, f, { contentType: f.type, upsert: false });
            if (upErr) {
                console.error('photo upload failed', upErr);
                continue;
            }
            const { data: pub } = supabase.storage.from('boat-photos').getPublicUrl(destPath);
            const url = pub?.publicUrl;
            await supabase.from('property_photos').insert({
                boat_uuid: boatUuid,
                url,
                thumbnail_url: url,
                storage_path: destPath,
                sort_order: baseSort + i,
            });
        }
        pendingPhotos.forEach(p => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
        setPendingPhotos([]);
    };

    const fetchSeasonalRates = async () => {
        setLoadingRates(true);
        const { data, error } = await supabase
            .from('seasonal_prices')
            .select('*')
            .eq('v_uuid', boat.v_uuid)
            .order('start_date', { ascending: true });
        
        if (!error && data) {
            setSeasonalRates(data);
        }
        setLoadingRates(false);
    };

    const handleAddRate = async (rateObj) => {
        const payload = {
            start_date: rateObj.start_date,
            end_date: rateObj.end_date,
            amount: parseFloat(rateObj.amount),
            minimum_nights: parseInt(rateObj.minimum_nights, 10) || 7,
            allowed_checkin_days: rateObj.allowed_checkin_days || 'Flexible check in days',
        };
        if (!boat.v_uuid) {
            const queued = { ...payload, id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, _pending: true };
            setPendingRates(prev => [...prev, queued].sort((a, b) => new Date(a.start_date) - new Date(b.start_date)));
            return;
        }
        const { data, error } = await supabase
            .from('seasonal_prices')
            .insert([{ v_uuid: boat.v_uuid, ...payload }])
            .select()
            .single();
        if (error) { alert('Error adding rate: ' + error.message); return; }
        setSeasonalRates(prev => [...prev, data].sort((a, b) => new Date(a.start_date) - new Date(b.start_date)));
    };

    const handleDeleteRate = async (rate) => {
        if (!window.confirm('Delete this rate?')) return;
        if (rate._pending || String(rate.id).startsWith('pending_')) {
            setPendingRates(prev => prev.filter(r => r.id !== rate.id));
            return;
        }
        const { error } = await supabase.from('seasonal_prices').delete().eq('id', rate.id);
        if (error) { alert('Error: ' + error.message); return; }
        setSeasonalRates(prev => prev.filter(r => r.id !== rate.id));
    };

    const flushPendingRates = async (boatUuid) => {
        if (!pendingRates.length) return;
        const rows = pendingRates.map(r => ({
            v_uuid: boatUuid,
            start_date: r.start_date,
            end_date: r.end_date,
            amount: r.amount,
            minimum_nights: r.minimum_nights,
            allowed_checkin_days: r.allowed_checkin_days,
        }));
        const { error: rErr } = await supabase.from('seasonal_prices').insert(rows);
        if (rErr) {
            console.error('seasonal rate flush failed', rErr);
            alert(`Seasonal rates not saved: ${rErr.message}`);
            return;
        }
        setPendingRates([]);
    };

    const fetchOwners = async () => {
        try {
            let query = supabase
                .from('owners')
                .select('id, name, agent_id, agents:agent_id(id, company_name)')
                .eq('is_active', true);

            if (role === 'agent') {
                // agents.id IS the auth user uuid.
                query = query.eq('agent_id', user.id);
            }

            const { data, error } = await query.order('name');
            if (!error && data) {
                setOwners(data);
            }
        } catch (err) {
            console.error("Fetch owners info error:", err);
        }
    };

    // Resolve the captator (the agent on owners.agent_id of the boat's owner).
    useEffect(() => {
        const own = owners.find(o => o.id === form.owner_id);
        setCaptatorAgent(own?.agents || null);
    }, [owners, form.owner_id]);

    const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    const aiPatchableSnapshot = () => ({
        boat_name: form.boat_name,
        manufacturer: form.manufacturer,
        model: form.model,
        year: form.year,
        type: form.type,
        length_ft: form.length_ft,
        beam_ft: form.beam_ft,
        draft_ft: form.draft_ft,
        guest_capacity_day: form.guest_capacity_day,
        guest_capacity_overnight: form.guest_capacity_overnight,
        cabins: form.cabins,
        bathrooms: form.bathrooms,
        daily_price: form.daily_price,
        weekly_price: form.weekly_price,
        security_deposit: form.security_deposit,
        cleaning_fee: form.cleaning_fee,
        fuel_policy: form.fuel_policy,
        skipper_type: form.skipper_type,
        tagline: form.tagline,
        description: form.description,
        registration_number: form.registration_number,
        location_base_port: form.location_base_port,
        features: form.features,
    });

    const handleAiRequest = async ({ text, audioFile }) =>
        requestBoatAiPatch({ currentRow: aiPatchableSnapshot(), text, audioFile });

    const handleAiApply = (patch) => {
        setForm(prev => ({ ...prev, ...patch }));
    };

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            // Captator commission floor: 5%. Default + clamp so the locked-price
            // 5+5+10 model holds even if someone edits the form down.
            const captatorPct = Math.max(5, parseFloat(form.editor_commission_pct) || 5);
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
                price_locked: !!form.price_locked,
                ical_url: form.ical_url?.trim() || null,
                editor_commission_pct: captatorPct,
                editor_commission_included: !!form.editor_commission_included,
                owner_id: role === 'owner' ? user.id : (form.owner_id || null),
                created_by: boat.v_uuid ? (boat.created_by || user.id) : user.id,
                // New boats need super_admin approval before going live
                ...(boat.v_uuid ? {} : { is_active: (role === 'admin' || role === 'super_admin') ? true : false })
            };

            let result;
            if (boat.v_uuid) {
                result = await supabase
                    .from('boats')
                    .update(boatData)
                    .eq('v_uuid', boat.v_uuid)
                    .select()
                    .single();
            } else {
                result = await supabase
                    .from('boats')
                    .insert([boatData])
                    .select()
                    .single();
            }

            if (result.error) throw result.error;
            const savedBoat = result.data;
            if (pendingPhotos.length) {
                try {
                    await uploadPendingPhotos(savedBoat.v_uuid);
                    await fetchExistingPhotos();
                } catch (e) {
                    console.error('photo upload error', e);
                    setError(`Boat saved but photo upload failed: ${e.message}`);
                    return;
                }
            }
            if (pendingRates.length) {
                try {
                    await flushPendingRates(savedBoat.v_uuid);
                } catch (e) {
                    console.error('rate flush error', e);
                    setError(`Boat saved but seasonal rates failed: ${e.message}`);
                    return;
                }
            }
            onSaved(savedBoat);
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

                {/* Tabs (super_admin only) */}
                {role === 'super_admin' && boat.v_uuid && (
                    <div className="px-6 pt-4 border-b border-border flex gap-1 overflow-x-auto">
                        {['details', 'visibility'].map(t => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => setActiveTab(t)}
                                className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-t-lg transition-all ${activeTab === t ? 'bg-primary/10 text-primary border-b-2 border-primary' : 'text-text-muted hover:text-text-primary'}`}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                )}

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    {activeTab === 'visibility' && role === 'super_admin' && (
                        <EntityVisibilityTab entityType="boat" entityId={boat.v_uuid} />
                    )}

                    {activeTab === 'details' && (<>
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
                            <Field label="Thumbnail URL (fallback)" field="thumbnail_url" form={form} handleChange={handleChange} fullWidth />
                        </div>
                    </section>

                    {/* Photos — drag & drop */}
                    <section>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-4 flex items-center gap-2">
                            <span className="material-symbols-outlined notranslate text-sm">photo_library</span>
                            Photos
                        </p>

                        <div
                            {...getPhotoRootProps()}
                            className={`border-2 border-dashed rounded-xl transition-all p-6 text-center cursor-pointer ${
                                isPhotoDragActive
                                    ? 'border-primary bg-primary/10 scale-[1.01]'
                                    : 'border-border hover:border-primary/50 hover:bg-surface-2'
                            }`}
                        >
                            <input {...getPhotoInputProps()} />
                            <span className="material-symbols-outlined notranslate text-3xl text-text-muted">cloud_upload</span>
                            <p className="text-sm font-medium text-text-primary mt-2">
                                {isPhotoDragActive ? 'Drop photos here' : 'Drag photos or PDF brochures · click to select'}
                            </p>
                            <p className="text-[10px] text-text-muted mt-1">
                                JPG / PNG / WEBP — PDFs will have embedded photos extracted automatically
                            </p>
                        </div>

                        {extractingPdf && (
                            <p className="text-[11px] text-primary mt-2 flex items-center gap-2">
                                <span className="material-symbols-outlined notranslate text-sm animate-spin">progress_activity</span>
                                Extracting photos from PDF…
                            </p>
                        )}

                        {(pendingPhotos.length > 0 || existingPhotos.length > 0) && (
                            <div className="mt-4 grid grid-cols-3 gap-3">
                                {existingPhotos.map(p => (
                                    <div key={`ex_${p.id}`} className="relative rounded-lg overflow-hidden border border-border bg-surface-2 aspect-video">
                                        <img src={p.thumbnail_url || p.url} alt="" className="w-full h-full object-cover" />
                                        <button
                                            type="button"
                                            onClick={() => deleteExistingPhoto(p)}
                                            className="absolute top-1 right-1 size-7 rounded-full bg-black/60 text-white hover:bg-red-500 flex items-center justify-center"
                                            title="Delete"
                                        >
                                            <span className="material-symbols-outlined notranslate text-[14px]">delete</span>
                                        </button>
                                    </div>
                                ))}
                                {pendingPhotos.map(p => (
                                    <div key={p.id} className="relative rounded-lg overflow-hidden border-2 border-primary/40 bg-surface-2 aspect-video">
                                        <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                                        <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-primary text-white">
                                            new
                                        </span>
                                        {p.sourcePdf && (
                                            <span className="absolute bottom-1 left-1 right-1 text-[9px] text-white bg-black/60 px-1.5 py-0.5 rounded truncate">
                                                from {p.sourcePdf}
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => removePending(p.id)}
                                            className="absolute top-1 right-1 size-7 rounded-full bg-black/60 text-white hover:bg-red-500 flex items-center justify-center"
                                            title="Remove"
                                        >
                                            <span className="material-symbols-outlined notranslate text-[14px]">close</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
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

                            <label className="col-span-2 flex items-center gap-2 cursor-pointer p-3 bg-surface-2 rounded-lg border border-border">
                                <input
                                    type="checkbox"
                                    className="accent-primary"
                                    checked={!!form.price_locked}
                                    onChange={e => handleChange('price_locked', e.target.checked)}
                                />
                                <span className="text-xs text-text-primary">
                                    <span className="font-bold">Lock price for agents</span>
                                    <span className="text-text-muted ml-2">— locked: total commission ≥ 20% (captator 5 / platform 5 / B2C agent 10). Unlocked: 5 + 5 baseline, agent sets the rest freely.</span>
                                </span>
                            </label>

                            {/* Captator commission */}
                            <div className="col-span-2 grid grid-cols-2 gap-4 p-3 bg-surface-2/60 rounded-lg border border-border">
                                <div>
                                    <label className="block text-xs text-text-muted mb-1.5 font-medium">Captator Commission (%)</label>
                                    <input
                                        type="number"
                                        min={5}
                                        step="0.5"
                                        className="input-theme w-full"
                                        value={form.editor_commission_pct}
                                        onChange={e => handleChange('editor_commission_pct', e.target.value)}
                                    />
                                    <p className="text-[10px] text-text-muted mt-1 italic">Fee earned by the captator agent on every booking. Minimum 5%.</p>
                                </div>
                                <div className="flex items-end">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            className="accent-primary"
                                            checked={!!form.editor_commission_included}
                                            onChange={e => handleChange('editor_commission_included', e.target.checked)}
                                        />
                                        <span className="text-xs text-text-primary">
                                            <span className="font-bold">Commission included in base price</span>
                                            <span className="block text-[10px] text-text-muted">If off, captator fee is added on top of the listing price.</span>
                                        </span>
                                    </label>
                                </div>
                            </div>

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

                    {/* Seasonal Pricing — calendar */}
                    <section>
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary flex items-center gap-2">
                                <span className="material-symbols-outlined notranslate text-sm">calendar_month</span>
                                Seasonal Pricing (Daily)
                            </p>
                            {!boat.v_uuid && pendingRates.length > 0 && (
                                <span className="text-[10px] text-amber-400 font-black uppercase tracking-widest">
                                    {pendingRates.length} rates pending boat save
                                </span>
                            )}
                        </div>
                        {loadingRates ? (
                            <p className="text-[10px] text-text-muted italic">Loading rates...</p>
                        ) : (
                            <SeasonalPricingCalendar
                                rates={[...seasonalRates, ...pendingRates]}
                                onAddRate={handleAddRate}
                                onDeleteRate={handleDeleteRate}
                                monthsAhead={12}
                            />
                        )}
                    </section>

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
                            {(canAddBoats || role === 'agent') && (
                                <div className="col-span-2 space-y-2">
                                    <label className="block text-xs text-text-muted mb-1.5 font-medium">
                                        {role === 'agent' ? 'Associated Owner (Contact)' : 'Yacht Owner'}
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
                                    <p className="text-[10px] text-text-muted mt-1 italic">
                                        {role === 'agent'
                                            ? 'You can only select owners that you manage as direct contacts.'
                                            : 'Note: Owners must be registered as users first.'}
                                    </p>
                                    {(role === 'super_admin' || role === 'admin') && form.owner_id && (
                                        <div className="px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg flex items-center justify-between">
                                            <span className="text-[10px] text-text-muted uppercase tracking-widest font-bold">Captator Agent</span>
                                            <span className="text-xs font-bold text-primary">
                                                {captatorAgent?.company_name || '— (owner unmanaged)'}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="col-span-2">
                                <label className="block text-xs text-text-muted mb-1.5 font-medium">iCal Availability URL</label>
                                <input
                                    type="text"
                                    className="input-theme w-full"
                                    placeholder="https://airbnb.com/.../calendar.ics"
                                    value={form.ical_url}
                                    onChange={e => handleChange('ical_url', e.target.value)}
                                />
                                <p className="text-[10px] text-text-muted mt-1 italic">Hourly server sync — blocked dates appear on the booking calendar.</p>
                            </div>
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
                    </>)}
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-border flex justify-end gap-3">
                    <button
                        onClick={() => setShowAiEdit(true)}
                        disabled={saving}
                        className="px-4 py-2.5 rounded-lg border border-primary/30 text-sm text-primary hover:bg-primary/10 transition-all flex items-center gap-2 mr-auto disabled:opacity-50"
                    >
                        <span className="material-symbols-outlined notranslate text-[16px]">auto_awesome</span>
                        AI edit
                    </button>
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
            {showAiEdit && (
                <AiEditOverlay
                    currentRow={aiPatchableSnapshot()}
                    onRequestPatch={handleAiRequest}
                    onApply={handleAiApply}
                    onClose={() => setShowAiEdit(false)}
                />
            )}
        </div>
    );
}
