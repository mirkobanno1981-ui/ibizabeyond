import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
    uploadVillaPhoto,
    deleteVillaPhotoFromStorage,
    validatePhoto,
    ALLOWED_MIME,
    MAX_SIZE_MB,
} from '../lib/villaPhotoUpload';
import {
    uploadVillaVideo,
    deleteVillaVideoFromStorage,
    validateVideo,
    ALLOWED_MIME as ALLOWED_VIDEO_MIME,
    MAX_SIZE_MB as MAX_VIDEO_SIZE_MB,
} from '../lib/villaVideoUpload';
import GpsMapPicker from './GpsMapPicker';
import SeasonalPricingCalendar from './SeasonalPricingCalendar';
import FeatureCategoryGrid from './FeatureCategoryGrid';
import CityAreaPicker from './CityAreaPicker';
import EntityVisibilityTab from './EntityVisibilityTab';

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
    const { role, user, agentData } = useAuth();
    const [owners, setOwners] = useState([]);
    const [editors, setEditors] = useState([]);
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
        property_type: villa.property_type || 'villa',
        gps: villa.gps || '',
        deposit: villa.deposit || 0,
        features: villa.features || [],
        owner_id: villa.owner_id || '',
        ses_establishment_code: villa.ses_establishment_code || '',
        is_active: villa.is_active !== false, // default true
        capturer_commission_mode: villa.capturer_commission_mode || 'percent',
        capturer_commission_pct:
            villa.capturer_commission_pct ?? villa.editor_markup_percent ?? 0,
        capturer_commission_amount: villa.capturer_commission_amount ?? 0,
        capturer_commission_included: !!villa.capturer_commission_included,
        city_id: villa.city_id || null,
        area_id: villa.area_id || null,
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [activeTab, setActiveTab] = useState('details');

    // Photos state: loaded rows from DB + pending local files added in this session
    const [photos, setPhotos] = useState([]);
    const [pendingFiles, setPendingFiles] = useState([]); // { id, file, previewUrl }
    const [deletedPhotoIds, setDeletedPhotoIds] = useState([]); // property_photos.id list
    const [photoError, setPhotoError] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(null); // { done, total }

    // Videos state (mirror photo state)
    const [videos, setVideos] = useState([]);
    const [pendingVideos, setPendingVideos] = useState([]); // { id, file, previewUrl }
    const [deletedVideoIds, setDeletedVideoIds] = useState([]);
    const [videoError, setVideoError] = useState(null);
    const [videoProgress, setVideoProgress] = useState(null);

    // Seasonal rates (saved + pending for unsaved villa)
    const [seasonalRates, setSeasonalRates] = useState([]);
    const [pendingRates, setPendingRates] = useState([]);

    const RENTAL_TYPE_DEFAULTS = {
        daily:    { enabled: true,  commission_mode: 'percent', commission_pct: 15, commission_amount: 0, platform_retention_pct: 33, commission_included_override: null },
        monthly:  { enabled: false, commission_mode: 'percent', commission_pct: 10, commission_amount: 0, platform_retention_pct: 30, commission_included_override: null },
        seasonal: { enabled: false, commission_mode: 'percent', commission_pct: 12, commission_amount: 0, platform_retention_pct: 30, commission_included_override: null },
        annual:   { enabled: false, commission_mode: 'percent', commission_pct:  8, commission_amount: 0, platform_retention_pct: 25, commission_included_override: null },
    };
    const [rentalTypeConfigs, setRentalTypeConfigs] = useState(() => {
        const saved = villa.rental_type_configs || {};
        const merged = {};
        for (const t of Object.keys(RENTAL_TYPE_DEFAULTS)) {
            merged[t] = { ...RENTAL_TYPE_DEFAULTS[t], ...(saved[t] || {}) };
        }
        return merged;
    });

    const isManual = (villa.source || form.__source) === 'manual' || !villa.v_uuid;

    useEffect(() => {
        if (role === 'admin' || role === 'super_admin' || role === 'editor') {
            fetchOwners();
        }
        if (villa.v_uuid) {
            fetchPhotos();
            fetchVideos();
            fetchSeasonalRates();
        }
    }, [role, villa.v_uuid]);

    useEffect(() => {
        return () => {
            pendingFiles.forEach(p => URL.revokeObjectURL(p.previewUrl));
            pendingVideos.forEach(p => URL.revokeObjectURL(p.previewUrl));
        };
    }, [pendingFiles, pendingVideos]);

    const fetchOwners = async () => {
        try {
            let query = supabase
                .from('owners')
                .select('id, name')
                .eq('is_active', true);

            if (role === 'agent' || role === 'editor') {
                const agentId = agentData?.id || user.id;
                query = query.eq('agent_id', agentId);
            }

            const { data, error } = await query.order('name');
            if (!error && data) setOwners(data);

            // For super_admin/admin: also fetch editors as assignable owners
            if (role === 'super_admin' || role === 'admin') {
                const { data: editorRoles } = await supabase
                    .from('user_roles')
                    .select('user_id')
                    .eq('role', 'editor');
                const editorIds = (editorRoles || []).map(r => r.user_id);
                if (editorIds.length > 0) {
                    const { data: editorAgents } = await supabase
                        .from('agents')
                        .select('id, company_name, email')
                        .in('id', editorIds);
                    setEditors((editorAgents || []).sort((a, b) =>
                        (a.company_name || a.email || '').localeCompare(b.company_name || b.email || '')
                    ));
                }
            }
        } catch (err) {
            console.error('Fetch owners error:', err);
        }
    };

    const fetchPhotos = async () => {
        const { data, error } = await supabase
            .from('property_photos')
            .select('id, url, thumbnail_url, sort_order, storage_path, caption')
            .eq('v_uuid', villa.v_uuid)
            .order('sort_order', { ascending: true });
        if (!error && data) setPhotos(data);
    };

    const fetchVideos = async () => {
        const { data, error } = await supabase
            .from('property_videos')
            .select('id, url, storage_path, caption, sort_order')
            .eq('v_uuid', villa.v_uuid)
            .order('sort_order', { ascending: true });
        if (!error && data) setVideos(data);
    };

    const fetchSeasonalRates = async () => {
        const { data, error } = await supabase
            .from('seasonal_prices')
            .select('*')
            .eq('v_uuid', villa.v_uuid)
            .order('start_date', { ascending: true });
        if (!error && data) setSeasonalRates(data);
    };

    const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    // Dropzone
    const onDrop = useCallback((accepted, rejected) => {
        setPhotoError(null);
        if (rejected && rejected.length) {
            setPhotoError(rejected.map(r => `${r.file.name}: ${r.errors.map(e => e.message).join(', ')}`).join(' | '));
        }
        const valid = [];
        for (const f of accepted) {
            const v = validatePhoto(f);
            if (v) {
                setPhotoError(prev => (prev ? prev + ' | ' : '') + v);
            } else {
                valid.push({
                    id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    file: f,
                    previewUrl: URL.createObjectURL(f),
                });
            }
        }
        if (valid.length) setPendingFiles(prev => [...prev, ...valid]);
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: ALLOWED_MIME.reduce((acc, t) => ({ ...acc, [t]: [] }), {}),
        multiple: true,
        maxSize: MAX_SIZE_MB * 1024 * 1024,
    });

    // Video dropzone
    const onVideoDrop = useCallback((accepted, rejected) => {
        setVideoError(null);
        if (rejected && rejected.length) {
            setVideoError(rejected.map(r => `${r.file.name}: ${r.errors.map(e => e.message).join(', ')}`).join(' | '));
        }
        const valid = [];
        for (const f of accepted) {
            const v = validateVideo(f);
            if (v) {
                setVideoError(prev => (prev ? prev + ' | ' : '') + v);
            } else {
                valid.push({
                    id: `pending_v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    file: f,
                    previewUrl: URL.createObjectURL(f),
                });
            }
        }
        if (valid.length) setPendingVideos(prev => [...prev, ...valid]);
    }, []);

    const {
        getRootProps: getVideoRootProps,
        getInputProps: getVideoInputProps,
        isDragActive: isVideoDragActive,
    } = useDropzone({
        onDrop: onVideoDrop,
        accept: ALLOWED_VIDEO_MIME.reduce((acc, t) => ({ ...acc, [t]: [] }), {}),
        multiple: true,
        maxSize: MAX_VIDEO_SIZE_MB * 1024 * 1024,
    });

    const removePendingFile = id => {
        setPendingFiles(prev => {
            const target = prev.find(p => p.id === id);
            if (target) URL.revokeObjectURL(target.previewUrl);
            return prev.filter(p => p.id !== id);
        });
    };

    const removePendingVideo = id => {
        setPendingVideos(prev => {
            const target = prev.find(p => p.id === id);
            if (target) URL.revokeObjectURL(target.previewUrl);
            return prev.filter(p => p.id !== id);
        });
    };

    const markVideoDeleted = videoId => {
        setVideos(prev => prev.filter(v => v.id !== videoId));
        setDeletedVideoIds(prev => [...prev, videoId]);
    };

    const moveVideo = (index, direction) => {
        setVideos(prev => {
            const next = [...prev];
            const newIdx = index + direction;
            if (newIdx < 0 || newIdx >= next.length) return prev;
            [next[index], next[newIdx]] = [next[newIdx], next[index]];
            return next.map((v, idx) => ({ ...v, sort_order: idx }));
        });
    };

    const markPhotoDeleted = photoId => {
        setPhotos(prev => prev.filter(p => p.id !== photoId));
        setDeletedPhotoIds(prev => [...prev, photoId]);
    };

    const setAsCover = photoId => {
        setPhotos(prev => {
            const target = prev.find(p => p.id === photoId);
            if (!target) return prev;
            const others = prev.filter(p => p.id !== photoId);
            const reordered = [target, ...others].map((p, idx) => ({ ...p, sort_order: idx }));
            return reordered;
        });
    };

    const movePhoto = (index, direction) => {
        setPhotos(prev => {
            const next = [...prev];
            const newIdx = index + direction;
            if (newIdx < 0 || newIdx >= next.length) return prev;
            [next[index], next[newIdx]] = [next[newIdx], next[index]];
            return next.map((p, idx) => ({ ...p, sort_order: idx }));
        });
    };

    const handleAddRate = async (rateObj) => {
        const payload = {
            start_date: rateObj.start_date,
            end_date: rateObj.end_date,
            amount: parseFloat(rateObj.amount),
            minimum_nights: parseInt(rateObj.minimum_nights, 10) || 7,
            allowed_checkin_days: rateObj.allowed_checkin_days || 'Flexible check in days',
        };
        if (!villa.v_uuid) {
            const queued = { ...payload, id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, _pending: true };
            setPendingRates(prev => [...prev, queued].sort((a, b) => new Date(a.start_date) - new Date(b.start_date)));
            return;
        }
        const { data, error } = await supabase
            .from('seasonal_prices')
            .insert([{ v_uuid: villa.v_uuid, ...payload }])
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

    const cover = useMemo(() => {
        if (photos.length) return photos[0];
        if (pendingFiles.length) return { previewUrl: pendingFiles[0].previewUrl };
        return null;
    }, [photos, pendingFiles]);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setSuccess(null);
        try {
            // License optional: villa or apartment may not have a tourist license.

            const isNew = !villa.v_uuid;
            const canAdd = role === 'admin' || role === 'super_admin' || role === 'editor';
            const isAdmin = role === 'admin' || role === 'super_admin';
            const isOwnerOfVilla = role === 'owner' && villa.owner_id === user?.id;
            const isEditorOfVilla = role === 'editor' && villa.created_by === user?.id;

            if (isNew && !canAdd) {
                throw new Error('Permission denied: editor role required to add villas.');
            }
            if (!isNew && !isAdmin && !isOwnerOfVilla && !isEditorOfVilla) {
                throw new Error('Permission denied: you can only edit villas you created.');
            }

            // Derive thumbnail_url from cover photo if we have photos in state; otherwise keep form value.
            let derivedThumbnail = form.thumbnail_url;
            if (photos.length > 0) {
                derivedThumbnail = photos[0].url;
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
                thumbnail_url: derivedThumbnail,
                license: form.license || null,
                property_type: form.property_type || 'villa',
                gps: form.gps,
                deposit: parseFloat(form.deposit) || 0,
                features: form.features,
                owner_id: role === 'owner' ? user.id : (form.owner_id || null),
                ses_establishment_code: form.ses_establishment_code,
                // New villas need super_admin approval before going live (admin/super_admin auto-approve)
                is_active: isNew ? (isAdmin ? form.is_active : false) : form.is_active,
                created_by: isNew ? user.id : villa.created_by,
                capturer_commission_mode: form.capturer_commission_mode || 'percent',
                capturer_commission_pct: parseFloat(form.capturer_commission_pct) || 0,
                capturer_commission_amount: parseFloat(form.capturer_commission_amount) || 0,
                capturer_commission_included: !!form.capturer_commission_included,
                rental_type_configs: rentalTypeConfigs,
                city_id: form.city_id || null,
                area_id: form.area_id || null,
            };

            if (isNew) {
                villaData.source = villa.source || 'manual';
            }

            let savedVilla;
            if (isNew) {
                const { data, error: insErr } = await supabase
                    .from('properties')
                    .insert([villaData])
                    .select()
                    .single();
                if (insErr) throw insErr;
                savedVilla = data;

                if (pendingRates.length > 0) {
                    const rows = pendingRates.map(r => ({
                        v_uuid: savedVilla.v_uuid,
                        start_date: r.start_date,
                        end_date: r.end_date,
                        amount: r.amount,
                        minimum_nights: r.minimum_nights,
                        allowed_checkin_days: r.allowed_checkin_days,
                    }));
                    const { data: inserted, error: ratesErr } = await supabase
                        .from('seasonal_prices')
                        .insert(rows)
                        .select();
                    if (ratesErr) console.error('Failed to flush seasonal rates:', ratesErr);
                    else if (inserted) {
                        setSeasonalRates(prev => [...prev, ...inserted].sort((a, b) => new Date(a.start_date) - new Date(b.start_date)));
                        setPendingRates([]);
                    }
                }
            } else {
                const { data, error: updErr } = await supabase
                    .from('properties')
                    .update(villaData)
                    .eq('v_uuid', villa.v_uuid)
                    .select()
                    .single();
                if (updErr) throw updErr;
                savedVilla = data;
            }

            const vUuid = savedVilla.v_uuid;

            // 1) Apply deleted photos: remove storage objects + rows
            if (deletedPhotoIds.length) {
                const { data: toDelete } = await supabase
                    .from('property_photos')
                    .select('id, storage_path')
                    .in('id', deletedPhotoIds);
                if (toDelete && toDelete.length) {
                    const paths = toDelete.map(p => p.storage_path).filter(Boolean);
                    if (paths.length) {
                        await supabase.storage.from('villa-photos').remove(paths);
                    }
                }
                await supabase.from('property_photos').delete().in('id', deletedPhotoIds);
            }

            // 2) Upload pending files, insert rows
            let nextSortOrder = photos.length;
            const insertedPhotos = [];
            if (pendingFiles.length > 0) {
                setUploadProgress({ done: 0, total: pendingFiles.length });
            }
            for (let i = 0; i < pendingFiles.length; i++) {
                const pf = pendingFiles[i];
                const { url, storage_path } = await uploadVillaPhoto(pf.file, vUuid);
                const row = {
                    v_uuid: vUuid,
                    url,
                    thumbnail_url: url,
                    sort_order: nextSortOrder++,
                    storage_path,
                };
                const { data: inserted, error: photoInsErr } = await supabase
                    .from('property_photos')
                    .insert([row])
                    .select()
                    .single();
                if (photoInsErr) {
                    await deleteVillaPhotoFromStorage(storage_path);
                    throw photoInsErr;
                }
                insertedPhotos.push(inserted);
                setUploadProgress({ done: i + 1, total: pendingFiles.length });
            }

            // 3) Persist reordering for existing photos (sort_order may have changed via setAsCover / movePhoto)
            for (const p of photos) {
                await supabase
                    .from('property_photos')
                    .update({ sort_order: p.sort_order })
                    .eq('id', p.id);
            }

            // 4) If cover changed, mirror first photo URL into properties.thumbnail_url
            const finalPhotos = [...photos, ...insertedPhotos].sort((a, b) => a.sort_order - b.sort_order);
            if (finalPhotos.length && finalPhotos[0].url !== savedVilla.thumbnail_url) {
                const { data: updated } = await supabase
                    .from('properties')
                    .update({ thumbnail_url: finalPhotos[0].url })
                    .eq('v_uuid', vUuid)
                    .select()
                    .single();
                if (updated) savedVilla = updated;
            }

            // 5) Apply deleted videos: storage + rows
            if (deletedVideoIds.length) {
                const { data: toDelete } = await supabase
                    .from('property_videos')
                    .select('id, storage_path')
                    .in('id', deletedVideoIds);
                if (toDelete && toDelete.length) {
                    const paths = toDelete.map(v => v.storage_path).filter(Boolean);
                    if (paths.length) {
                        await supabase.storage.from('villa-videos').remove(paths);
                    }
                }
                await supabase.from('property_videos').delete().in('id', deletedVideoIds);
            }

            // 6) Upload pending videos, insert rows
            let nextVideoSort = videos.length;
            const insertedVideos = [];
            if (pendingVideos.length > 0) {
                setVideoProgress({ done: 0, total: pendingVideos.length });
            }
            for (let i = 0; i < pendingVideos.length; i++) {
                const pv = pendingVideos[i];
                const { url, storage_path } = await uploadVillaVideo(pv.file, vUuid);
                const row = {
                    v_uuid: vUuid,
                    url,
                    sort_order: nextVideoSort++,
                    storage_path,
                };
                const { data: inserted, error: vidInsErr } = await supabase
                    .from('property_videos')
                    .insert([row])
                    .select()
                    .single();
                if (vidInsErr) {
                    await deleteVillaVideoFromStorage(storage_path);
                    throw vidInsErr;
                }
                insertedVideos.push(inserted);
                setVideoProgress({ done: i + 1, total: pendingVideos.length });
            }

            // 7) Persist video reordering
            for (const v of videos) {
                await supabase
                    .from('property_videos')
                    .update({ sort_order: v.sort_order })
                    .eq('id', v.id);
            }

            const finalVideos = [...videos, ...insertedVideos].sort((a, b) => a.sort_order - b.sort_order);

            // Reset session state
            pendingFiles.forEach(p => URL.revokeObjectURL(p.previewUrl));
            pendingVideos.forEach(p => URL.revokeObjectURL(p.previewUrl));
            setPendingFiles([]);
            setDeletedPhotoIds([]);
            setPhotos(finalPhotos);
            setPendingVideos([]);
            setDeletedVideoIds([]);
            setVideos(finalVideos);
            setUploadProgress(null);
            setVideoProgress(null);

            setSaving(false);
            setSuccess('Villa saved successfully');
            setTimeout(() => onSaved(savedVilla), 1200);
            return;
        } catch (err) {
            console.error('Villa save error:', err);
            const detail = err.details ? ` | details: ${err.details}` : '';
            const hint = err.hint ? ` | hint: ${err.hint}` : '';
            const code = err.code ? ` [${err.code}]` : '';
            setError(`${err.message || String(err)}${code}${detail}${hint}`);
            setUploadProgress(null);
            setVideoProgress(null);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="bg-surface border border-border rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
                {/* Header */}
                <div className="flex items-center gap-4 p-6 border-b border-border">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-surface-2 border border-border flex-shrink-0">
                        <img
                            src={(cover && (cover.url || cover.previewUrl)) || form.thumbnail_url || 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=400&q=60'}
                            className="w-full h-full object-cover"
                            alt=""
                        />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-lg font-bold text-text-primary truncate">{villa.v_uuid ? 'Edit Villa' : 'Add New Villa'}</h2>
                        <p className="text-xs text-text-muted mt-0.5 truncate">
                            {form.villa_name || 'Unnamed Property'}
                            {isManual && <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[10px] font-bold uppercase tracking-widest">Manual</span>}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-lg transition-colors"
                    >
                        <span className="material-symbols-outlined notranslate">close</span>
                    </button>
                </div>

                {/* Tabs (super_admin only) */}
                {role === 'super_admin' && villa.v_uuid && (
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
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="bg-green-500/10 border border-green-500/30 text-green-400 p-3 rounded-lg text-sm flex items-center gap-2">
                            <span className="material-symbols-outlined notranslate text-[16px]">check_circle</span>
                            {success}
                        </div>
                    )}

                    {activeTab === 'visibility' && role === 'super_admin' && (
                        <EntityVisibilityTab entityType="villa" entityId={villa.v_uuid} />
                    )}

                    {activeTab === 'details' && (<>
                    {/* Identity */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Identity & Content</p>
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Villa Name" field="villa_name" form={form} handleChange={handleChange} fullWidth />
                            <Field label="Tagline" field="tagline" form={form} handleChange={handleChange} fullWidth />
                            <div className="col-span-2">
                                <label className="block text-xs text-text-muted mb-1.5 font-medium">Property Type</label>
                                <select
                                    className="input-theme w-full"
                                    value={form.property_type}
                                    onChange={e => handleChange('property_type', e.target.value)}
                                >
                                    <option value="villa">Villa</option>
                                    <option value="apartment">Apartment</option>
                                </select>
                            </div>
                            <Field label="License Number (optional)" field="license" form={form} handleChange={handleChange} fullWidth />
                            <div className="col-span-2">
                                <label className="block text-xs text-text-muted mb-1.5 font-medium">GPS Coordinates</label>
                                <GpsMapPicker value={form.gps} onChange={v => handleChange('gps', v)} />
                            </div>
                            {(role === 'admin' || role === 'super_admin' || role === 'editor') && (
                                <div className="col-span-2">
                                    <label className="block text-xs text-text-muted mb-1.5 font-medium">
                                        {(role === 'agent' || role === 'editor') ? 'Associated Owner (Contact)' : 'Villa Owner'}
                                    </label>
                                    <select
                                        className="input-theme w-full"
                                        value={form.owner_id}
                                        onChange={e => handleChange('owner_id', e.target.value)}
                                        required={role === 'agent' || role === 'editor'}
                                    >
                                        <option value="">Select Owner...</option>
                                        {owners.length > 0 && (
                                            <optgroup label="Proprietari">
                                                {owners.map(o => (
                                                    <option key={`o-${o.id}`} value={o.id}>{o.name}</option>
                                                ))}
                                            </optgroup>
                                        )}
                                        {(role === 'super_admin' || role === 'admin') && editors.length > 0 && (
                                            <optgroup label="Captatori (Editor)">
                                                {editors.map(ed => (
                                                    <option key={`e-${ed.id}`} value={ed.id}>
                                                        {ed.company_name || ed.email || ed.id.slice(0, 8)} — Editor
                                                    </option>
                                                ))}
                                            </optgroup>
                                        )}
                                    </select>
                                    <p className="text-[10px] text-text-muted mt-2 italic">
                                        {(role === 'agent' || role === 'editor')
                                            ? 'You can only select owners that you manage as direct contacts.'
                                            : 'Note: Owners must be registered as users in the management section first.'}
                                    </p>
                                </div>
                            )}

                            {/* Visibility Status (Admin only) */}
                            {(role === 'super_admin') && (
                                <div className="col-span-2">
                                    <div className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all duration-300 ${
                                        form.is_active
                                            ? 'border-emerald-500/40 bg-emerald-500/5'
                                            : 'border-red-500/40 bg-red-500/5'
                                    }`}>
                                        <button
                                            type="button"
                                            onClick={() => handleChange('is_active', !form.is_active)}
                                            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 focus:outline-none flex-shrink-0 ${
                                                form.is_active ? 'bg-emerald-500' : 'bg-red-400'
                                            }`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${
                                                form.is_active ? 'translate-x-6' : 'translate-x-1'
                                            }`} />
                                        </button>
                                        <div className="flex-1">
                                            <p className={`text-sm font-bold ${
                                                form.is_active ? 'text-emerald-500' : 'text-red-400'
                                            }`}>
                                                {form.is_active ? '✓ Villa Active — Visible to public' : '✕ Villa Disabled — Hidden from public'}
                                            </p>
                                            <p className="text-[10px] text-text-muted mt-0.5">
                                                {form.is_active
                                                    ? 'Appears in searches and can be included in agent quotes.'
                                                    : 'Hidden from catalog. Not visible to agents or clients.'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Photos */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">Photos</p>
                                {(photos.length + pendingFiles.length) > 0 && (
                                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold">
                                        {photos.length + pendingFiles.length}
                                    </span>
                                )}
                            </div>
                            <p className="text-[10px] text-text-muted italic">First photo is the cover · Max {MAX_SIZE_MB} MB</p>
                        </div>

                        {/* Upload progress bar */}
                        {uploadProgress && (
                            <div className="mb-3">
                                <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
                                    <span>Uploading photos...</span>
                                    <span>{uploadProgress.done} / {uploadProgress.total}</span>
                                </div>
                                <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-primary rounded-full transition-all duration-300"
                                        style={{ width: `${(uploadProgress.done / uploadProgress.total) * 100}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        <div
                            {...getRootProps()}
                            className={`border-2 border-dashed rounded-xl transition-all ${
                                isDragActive
                                    ? 'border-primary bg-primary/10 scale-[1.01]'
                                    : 'border-border hover:border-primary/50 hover:bg-surface-2'
                            } ${
                                (photos.length + pendingFiles.length) === 0 ? 'p-10' : 'p-4'
                            } text-center cursor-pointer`}
                        >
                            <input {...getInputProps()} />
                            {isDragActive ? (
                                <>
                                    <span className="material-symbols-outlined notranslate text-4xl text-primary animate-bounce">file_upload</span>
                                    <p className="text-sm font-semibold text-primary mt-2">Drop photos here</p>
                                </>
                            ) : (
                                <>
                                    <span className={`material-symbols-outlined notranslate text-text-muted ${
                                        (photos.length + pendingFiles.length) === 0 ? 'text-5xl' : 'text-2xl'
                                    }`}>add_photo_alternate</span>
                                    <p className={`text-text-primary font-medium mt-1 ${
                                        (photos.length + pendingFiles.length) === 0 ? 'text-sm' : 'text-xs'
                                    }`}>
                                        {(photos.length + pendingFiles.length) === 0
                                            ? 'Drag photos here, or click to select'
                                            : 'Add more photos'}
                                    </p>
                                    {(photos.length + pendingFiles.length) === 0 && (
                                        <p className="text-[10px] text-text-muted mt-1">JPG, PNG, WEBP · Max {MAX_SIZE_MB} MB per file</p>
                                    )}
                                </>
                            )}
                        </div>

                        {photoError && (
                            <div className="mt-2 bg-red-500/10 border border-red-500/30 text-red-400 p-2 rounded text-xs flex items-start gap-2">
                                <span className="material-symbols-outlined notranslate text-[14px] mt-0.5 flex-shrink-0">error</span>
                                <span>{photoError}</span>
                            </div>
                        )}

                        {(photos.length > 0 || pendingFiles.length > 0) && (
                            <div className="grid grid-cols-3 gap-3 mt-4">
                                {photos.map((p, idx) => (
                                    <div
                                        key={p.id}
                                        className={`relative group rounded-xl overflow-hidden bg-surface-2 aspect-video ${
                                            idx === 0
                                                ? 'border-2 border-primary shadow-lg shadow-primary/20'
                                                : 'border border-border'
                                        }`}
                                    >
                                        <img src={p.thumbnail_url || p.url} alt="" className="w-full h-full object-cover" />
                                        {idx === 0 && (
                                            <span className="absolute top-2 left-2 px-2 py-0.5 bg-primary text-white text-[9px] font-bold uppercase rounded-full shadow">
                                                ★ Cover
                                            </span>
                                        )}
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-200">
                                            <div className="absolute bottom-2 left-0 right-0 flex items-center justify-center gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => movePhoto(idx, -1)}
                                                    disabled={idx === 0}
                                                    className="p-1.5 bg-white/20 backdrop-blur-sm text-white hover:bg-primary hover:text-white rounded-lg disabled:opacity-30 transition-all"
                                                    title="Move left"
                                                >
                                                    <span className="material-symbols-outlined notranslate text-[16px]">arrow_back</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => movePhoto(idx, 1)}
                                                    disabled={idx === photos.length - 1}
                                                    className="p-1.5 bg-white/20 backdrop-blur-sm text-white hover:bg-primary hover:text-white rounded-lg disabled:opacity-30 transition-all"
                                                    title="Move right"
                                                >
                                                    <span className="material-symbols-outlined notranslate text-[16px]">arrow_forward</span>
                                                </button>
                                                {idx !== 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setAsCover(p.id)}
                                                        className="p-1.5 bg-white/20 backdrop-blur-sm text-white hover:bg-amber-500 hover:text-white rounded-lg transition-all"
                                                        title="Set as cover"
                                                    >
                                                        <span className="material-symbols-outlined notranslate text-[16px]">star</span>
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => markPhotoDeleted(p.id)}
                                                    className="p-1.5 bg-white/20 backdrop-blur-sm text-white hover:bg-red-500 hover:text-white rounded-lg transition-all"
                                                    title="Delete photo"
                                                >
                                                    <span className="material-symbols-outlined notranslate text-[16px]">delete</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {pendingFiles.map(pf => (
                                    <div key={pf.id} className="relative group rounded-xl overflow-hidden border-2 border-dashed border-amber-500/60 bg-surface-2 aspect-video">
                                        <img src={pf.previewUrl} alt="" className="w-full h-full object-cover opacity-80" />
                                        <span className="absolute top-2 left-2 px-2 py-0.5 bg-amber-500 text-black text-[9px] font-bold uppercase rounded-full shadow">
                                            ⏳ Pending upload
                                        </span>
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-200">
                                            <div className="absolute bottom-2 left-0 right-0 flex items-center justify-center">
                                                <button
                                                    type="button"
                                                    onClick={() => removePendingFile(pf.id)}
                                                    className="p-1.5 bg-red-500/80 backdrop-blur-sm text-white hover:bg-red-500 rounded-lg transition-all"
                                                    title="Remove"
                                                >
                                                    <span className="material-symbols-outlined notranslate text-[16px]">delete</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {pendingFiles.length > 0 && (
                            <p className="mt-2 text-[10px] text-amber-500/80 italic flex items-center gap-1">
                                <span className="material-symbols-outlined notranslate text-[12px]">info</span>
                                {pendingFiles.length} photos pending upload. Click "Save Changes" to confirm.
                            </p>
                        )}
                    </div>

                    {/* Videos */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">Videos</p>
                                {(videos.length + pendingVideos.length) > 0 && (
                                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold">
                                        {videos.length + pendingVideos.length}
                                    </span>
                                )}
                            </div>
                            <p className="text-[10px] text-text-muted italic">MP4 / MOV / WEBM · Max {MAX_VIDEO_SIZE_MB} MB</p>
                        </div>

                        {videoProgress && (
                            <div className="mb-3">
                                <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
                                    <span>Uploading videos...</span>
                                    <span>{videoProgress.done} / {videoProgress.total}</span>
                                </div>
                                <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-primary rounded-full transition-all duration-300"
                                        style={{ width: `${(videoProgress.done / videoProgress.total) * 100}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        <div
                            {...getVideoRootProps()}
                            className={`border-2 border-dashed rounded-xl transition-all ${
                                isVideoDragActive
                                    ? 'border-primary bg-primary/10 scale-[1.01]'
                                    : 'border-border hover:border-primary/50 hover:bg-surface-2'
                            } ${
                                (videos.length + pendingVideos.length) === 0 ? 'p-10' : 'p-4'
                            } text-center cursor-pointer`}
                        >
                            <input {...getVideoInputProps()} />
                            {isVideoDragActive ? (
                                <>
                                    <span className="material-symbols-outlined notranslate text-4xl text-primary animate-bounce">file_upload</span>
                                    <p className="text-sm font-semibold text-primary mt-2">Drop videos here</p>
                                </>
                            ) : (
                                <>
                                    <span className={`material-symbols-outlined notranslate text-text-muted ${
                                        (videos.length + pendingVideos.length) === 0 ? 'text-5xl' : 'text-2xl'
                                    }`}>video_library</span>
                                    <p className={`text-text-primary font-medium mt-1 ${
                                        (videos.length + pendingVideos.length) === 0 ? 'text-sm' : 'text-xs'
                                    }`}>
                                        {(videos.length + pendingVideos.length) === 0
                                            ? 'Drag videos here, or click to select'
                                            : 'Add more videos'}
                                    </p>
                                    {(videos.length + pendingVideos.length) === 0 && (
                                        <p className="text-[10px] text-text-muted mt-1">MP4, MOV, WEBM · Max {MAX_VIDEO_SIZE_MB} MB per file</p>
                                    )}
                                </>
                            )}
                        </div>

                        {videoError && (
                            <div className="mt-2 bg-red-500/10 border border-red-500/30 text-red-400 p-2 rounded text-xs flex items-start gap-2">
                                <span className="material-symbols-outlined notranslate text-[14px] mt-0.5 flex-shrink-0">error</span>
                                <span>{videoError}</span>
                            </div>
                        )}

                        {(videos.length > 0 || pendingVideos.length > 0) && (
                            <div className="grid grid-cols-2 gap-3 mt-4">
                                {videos.map((v, idx) => (
                                    <div
                                        key={v.id}
                                        className="relative group rounded-xl overflow-hidden bg-surface-2 aspect-video border border-border"
                                    >
                                        <video src={v.url} className="w-full h-full object-cover" preload="metadata" controls />
                                        <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all duration-200">
                                            <div className="absolute bottom-2 left-0 right-0 flex items-center justify-center gap-1.5 pointer-events-auto">
                                                <button
                                                    type="button"
                                                    onClick={() => moveVideo(idx, -1)}
                                                    disabled={idx === 0}
                                                    className="p-1.5 bg-white/20 backdrop-blur-sm text-white hover:bg-primary hover:text-white rounded-lg disabled:opacity-30 transition-all"
                                                    title="Move up"
                                                >
                                                    <span className="material-symbols-outlined notranslate text-[16px]">arrow_back</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => moveVideo(idx, 1)}
                                                    disabled={idx === videos.length - 1}
                                                    className="p-1.5 bg-white/20 backdrop-blur-sm text-white hover:bg-primary hover:text-white rounded-lg disabled:opacity-30 transition-all"
                                                    title="Move down"
                                                >
                                                    <span className="material-symbols-outlined notranslate text-[16px]">arrow_forward</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => markVideoDeleted(v.id)}
                                                    className="p-1.5 bg-white/20 backdrop-blur-sm text-white hover:bg-red-500 hover:text-white rounded-lg transition-all"
                                                    title="Delete video"
                                                >
                                                    <span className="material-symbols-outlined notranslate text-[16px]">delete</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {pendingVideos.map(pv => (
                                    <div key={pv.id} className="relative group rounded-xl overflow-hidden border-2 border-dashed border-amber-500/60 bg-surface-2 aspect-video">
                                        <video src={pv.previewUrl} className="w-full h-full object-cover opacity-80" preload="metadata" controls />
                                        <span className="absolute top-2 left-2 px-2 py-0.5 bg-amber-500 text-black text-[9px] font-bold uppercase rounded-full shadow z-10">
                                            ⏳ Pending upload
                                        </span>
                                        <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-200">
                                            <div className="absolute bottom-2 left-0 right-0 flex items-center justify-center pointer-events-auto">
                                                <button
                                                    type="button"
                                                    onClick={() => removePendingVideo(pv.id)}
                                                    className="p-1.5 bg-red-500/80 backdrop-blur-sm text-white hover:bg-red-500 rounded-lg transition-all"
                                                    title="Remove"
                                                >
                                                    <span className="material-symbols-outlined notranslate text-[16px]">delete</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {pendingVideos.length > 0 && (
                            <p className="mt-2 text-[10px] text-amber-500/80 italic flex items-center gap-1">
                                <span className="material-symbols-outlined notranslate text-[12px]">info</span>
                                {pendingVideos.length} videos pending upload. Click "Save Changes" to confirm.
                            </p>
                        )}
                    </div>

                    {/* Location */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Location</p>
                        <CityAreaPicker
                            cityId={form.city_id}
                            areaId={form.area_id}
                            onChange={({ cityId, cityName, areaId, areaName }) => setForm(prev => ({
                                ...prev,
                                city_id: cityId,
                                area_id: areaId,
                                district: cityName || prev.district,
                                areaname: areaName || (areaId ? prev.areaname : ''),
                            }))}
                        />
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
                        {(role === 'admin' || role === 'super_admin' || role === 'editor') && (
                            <div className="mt-4 p-3 bg-surface-2/50 border border-primary/20 rounded-xl space-y-3">
                                <label className="block text-xs text-primary font-bold">Capturer Commission</label>
                                <div className="grid grid-cols-3 gap-3 items-end">
                                    <div>
                                        <label className="block text-[10px] text-text-muted mb-1.5 font-medium">Mode</label>
                                        <select
                                            className="input-theme w-full"
                                            value={form.capturer_commission_mode}
                                            onChange={e => handleChange('capturer_commission_mode', e.target.value)}
                                        >
                                            <option value="percent">% of price</option>
                                            <option value="fixed">Fixed €</option>
                                        </select>
                                    </div>
                                    {form.capturer_commission_mode === 'fixed' ? (
                                        <div>
                                            <label className="block text-[10px] text-text-muted mb-1.5 font-medium">Amount (€)</label>
                                            <input
                                                type="number"
                                                step="1"
                                                min="0"
                                                className="input-theme w-full"
                                                value={form.capturer_commission_amount}
                                                onChange={e => handleChange('capturer_commission_amount', e.target.value)}
                                            />
                                        </div>
                                    ) : (
                                        <div>
                                            <label className="block text-[10px] text-text-muted mb-1.5 font-medium">Percent (%)</label>
                                            <input
                                                type="number"
                                                step="0.5"
                                                min="0"
                                                max="100"
                                                className="input-theme w-full"
                                                value={form.capturer_commission_pct}
                                                onChange={e => handleChange('capturer_commission_pct', e.target.value)}
                                            />
                                        </div>
                                    )}
                                    <label className="flex items-center gap-2 cursor-pointer pb-2.5">
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 accent-primary"
                                            checked={!!form.capturer_commission_included}
                                            onChange={e => handleChange('capturer_commission_included', e.target.checked)}
                                        />
                                        <span className="text-xs text-text-primary font-medium">
                                            Included in price
                                        </span>
                                    </label>
                                </div>
                                <p className="text-[10px] text-text-muted italic">
                                    {form.capturer_commission_included
                                        ? 'Commission already inside Min/Max price — deducted from owner payout.'
                                        : 'Commission added on top of Min/Max price — paid by client, routed to capturer.'}
                                </p>
                            </div>
                        )}

                        {/* Rental Types & Commission */}
                        {(role === 'admin' || role === 'super_admin' || role === 'editor') && (
                            <div className="mt-4 p-3 bg-surface-2/50 border border-primary/20 rounded-xl space-y-2">
                                <p className="text-xs text-primary font-bold uppercase tracking-widest mb-2">Rental Types & Commission</p>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="text-text-muted text-[9px] uppercase tracking-widest">
                                                <th className="text-left pb-2 font-semibold w-28">Type</th>
                                                <th className="text-center pb-2 font-semibold w-16">Enabled</th>
                                                <th className="text-left pb-2 font-semibold">Commission</th>
                                                <th className="text-center pb-2 font-semibold w-24">Included?</th>
                                                {role === 'super_admin' && (
                                                    <th className="text-right pb-2 font-semibold">Platform %</th>
                                                )}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {[
                                                { key: 'daily',    label: 'Daily / Nightly' },
                                                { key: 'monthly',  label: 'Monthly' },
                                                { key: 'seasonal', label: 'Seasonal' },
                                                { key: 'annual',   label: 'Annual' },
                                            ].map(({ key, label }) => {
                                                const cfg = rentalTypeConfigs[key] || {};
                                                const isLocked = key === 'daily';
                                                const mode = cfg.commission_mode || 'percent';
                                                const disabled = !cfg.enabled && !isLocked;
                                                return (
                                                    <tr key={key} className={`border-t border-border/50 ${disabled ? 'opacity-50' : ''}`}>
                                                        <td className="py-1.5 pr-2 font-medium text-text-primary">{label}</td>
                                                        <td className="py-1.5 text-center">
                                                            {isLocked ? (
                                                                <span className="material-symbols-outlined notranslate text-primary text-[14px]">lock</span>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setRentalTypeConfigs(prev => ({
                                                                        ...prev,
                                                                        [key]: { ...prev[key], enabled: !prev[key].enabled }
                                                                    }))}
                                                                    className={`w-8 h-4 rounded-full transition-colors ${cfg.enabled ? 'bg-primary' : 'bg-surface-2'} relative inline-flex items-center`}
                                                                >
                                                                    <span className={`absolute w-3 h-3 bg-white rounded-full shadow transition-transform ${cfg.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                                                </button>
                                                            )}
                                                        </td>
                                                        <td className="py-1.5 pl-2">
                                                            <div className="flex items-center gap-1.5 justify-end">
                                                                <select
                                                                    disabled={disabled}
                                                                    className="input-theme text-xs py-1 px-1.5"
                                                                    value={mode}
                                                                    onChange={e => setRentalTypeConfigs(prev => ({
                                                                        ...prev,
                                                                        [key]: { ...prev[key], commission_mode: e.target.value }
                                                                    }))}
                                                                >
                                                                    <option value="percent">%</option>
                                                                    <option value="fixed">€</option>
                                                                </select>
                                                                {mode === 'fixed' ? (
                                                                    <>
                                                                        <input
                                                                            type="number"
                                                                            min="0"
                                                                            step="1"
                                                                            disabled={disabled}
                                                                            className="input-theme w-20 text-right text-xs"
                                                                            value={cfg.commission_amount ?? ''}
                                                                            onChange={e => setRentalTypeConfigs(prev => ({
                                                                                ...prev,
                                                                                [key]: { ...prev[key], commission_amount: parseFloat(e.target.value) || 0 }
                                                                            }))}
                                                                        />
                                                                        <span className="text-text-muted">€</span>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <input
                                                                            type="number"
                                                                            min="0"
                                                                            max="100"
                                                                            step="0.5"
                                                                            disabled={disabled}
                                                                            className="input-theme w-20 text-right text-xs"
                                                                            value={cfg.commission_pct ?? ''}
                                                                            onChange={e => setRentalTypeConfigs(prev => ({
                                                                                ...prev,
                                                                                [key]: { ...prev[key], commission_pct: parseFloat(e.target.value) || 0 }
                                                                            }))}
                                                                        />
                                                                        <span className="text-text-muted">%</span>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="py-1.5 text-center pl-2">
                                                            <select
                                                                disabled={disabled}
                                                                className="input-theme text-xs py-1 px-1.5"
                                                                value={
                                                                    cfg.commission_included_override === true ? 'yes'
                                                                  : cfg.commission_included_override === false ? 'no'
                                                                  : 'inherit'
                                                                }
                                                                onChange={e => {
                                                                    const v = e.target.value;
                                                                    const next = v === 'yes' ? true : v === 'no' ? false : null;
                                                                    setRentalTypeConfigs(prev => ({
                                                                        ...prev,
                                                                        [key]: { ...prev[key], commission_included_override: next }
                                                                    }));
                                                                }}
                                                            >
                                                                <option value="inherit">Inherit</option>
                                                                <option value="yes">Yes</option>
                                                                <option value="no">No</option>
                                                            </select>
                                                        </td>
                                                        {role === 'super_admin' && (
                                                            <td className="py-1.5 text-right pl-2">
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    max="100"
                                                                    step="0.5"
                                                                    disabled={disabled}
                                                                    className="input-theme w-16 text-right text-xs"
                                                                    value={cfg.platform_retention_pct ?? ''}
                                                                    onChange={e => setRentalTypeConfigs(prev => ({
                                                                        ...prev,
                                                                        [key]: { ...prev[key], platform_retention_pct: parseFloat(e.target.value) || 0 }
                                                                    }))}
                                                                />
                                                                <span className="ml-0.5 text-text-muted">%</span>
                                                            </td>
                                                        )}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <p className="text-[10px] text-text-muted italic mt-1">
                                    Per-type commission overrides the global Capturer Commission. <b>Included?</b> = inherit villa-level flag, or force Yes/No for this rental type.{role !== 'super_admin' ? ' Platform retention is set by Super Admin in a dedicated section.' : ' Platform % = platform\'s share of that commission.'}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Seasonal Pricing — calendar range picker */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">Seasonal Pricing (calendar)</p>
                            {!villa.v_uuid && pendingRates.length > 0 && (
                                <span className="text-[10px] text-amber-400 font-black uppercase tracking-widest">
                                    {pendingRates.length} rates pending villa save
                                </span>
                            )}
                        </div>
                        <SeasonalPricingCalendar
                            rates={[...seasonalRates, ...pendingRates]}
                            onAddRate={handleAddRate}
                            onDeleteRate={handleDeleteRate}
                            monthsAhead={12}
                        />
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
                        <FeatureCategoryGrid
                            selected={form.features}
                            onChange={list => handleChange('features', list)}
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Description</p>
                        <div className="grid grid-cols-1 gap-4">
                            <Field label="Detailed Description" field="description" type="textarea" form={form} handleChange={handleChange} fullWidth />
                        </div>
                    </div>
                    </>)}
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
                        disabled={saving || !!success}
                        className="btn-primary text-sm disabled:opacity-50 flex items-center gap-2"
                    >
                        <span className="material-symbols-outlined notranslate text-[16px]">{success ? 'check_circle' : (saving ? 'hourglass_empty' : 'save')}</span>
                        {success ? 'Saved' : (saving ? 'Saving...' : 'Save Changes')}
                    </button>
                </div>
            </div>
        </div>
    );
}
