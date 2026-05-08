import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { useAuth } from '../contexts/AuthContext';
import {
    uploadIngestFiles,
    extractBoat,
    commitBoat,
    ALLOWED_INGEST_MIME,
} from '../lib/boatIngestApi';
import { extractPhotosFromPdf, extractTextFromPdf } from '../lib/pdfPhotoExtract';
import SeasonalPricingCalendar from './SeasonalPricingCalendar';

const KIND_ICON = {
    image: 'image',
    pdf: 'description',
    audio: 'mic',
    text: 'article',
};

function inferKind(mime) {
    if (!mime) return 'text';
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf') return 'pdf';
    if (mime.startsWith('audio/')) return 'audio';
    return 'text';
}

const AiBadge = () => (
    <span
        title="Extracted by AI — verify and correct if needed"
        className="inline-flex items-center px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[9px] font-bold uppercase tracking-widest ml-1.5"
    >
        AI
    </span>
);

const Field = ({ label, value, onChange, type = 'text', aiHighlight = false, fullWidth = false, textarea = false }) => (
    <div className={fullWidth ? 'col-span-2' : ''}>
        <label className="block text-xs text-text-muted mb-1.5 font-medium">
            {label}
            {aiHighlight && <AiBadge />}
        </label>
        {textarea ? (
            <textarea
                className="input-theme w-full resize-none"
                rows={4}
                value={value ?? ''}
                onChange={e => onChange(e.target.value)}
            />
        ) : (
            <input
                type={type}
                className="input-theme w-full"
                value={value ?? ''}
                onChange={e => onChange(e.target.value)}
            />
        )}
    </div>
);

const FIELDS = [
    'boat_name', 'manufacturer', 'model', 'year', 'type',
    'length_ft', 'beam_ft', 'draft_ft',
    'cabins', 'bathrooms', 'guest_capacity_day', 'guest_capacity_overnight',
    'base_port', 'skipper_type', 'fuel_policy',
    'daily_price', 'weekly_price', 'security_deposit', 'cleaning_fee',
    'tagline', 'description', 'registration_number',
];

export default function BoatIngestModal({ onClose, onSaved }) {
    const { user } = useAuth();
    const [step, setStep] = useState('intake');
    const [text, setText] = useState('');
    const [files, setFiles] = useState([]);
    const [extractingPdf, setExtractingPdf] = useState(false);
    const [error, setError] = useState(null);
    const [jobId, setJobId] = useState(null);
    const [extracted, setExtracted] = useState(null);
    const [aiFields, setAiFields] = useState(new Set());
    const [form, setForm] = useState({});
    const [photos, setPhotos] = useState([]);
    const [confidence, setConfidence] = useState(null);
    const [groundingSources, setGroundingSources] = useState([]);
    const [wantMarketing, setWantMarketing] = useState(true);
    const [seasonalRates, setSeasonalRates] = useState([]);

    useEffect(() => () => {
        files.forEach(f => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
        photos.forEach(p => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    }, []); // eslint-disable-line

    const addFiles = useCallback(async (accepted) => {
        const pdfs = accepted.filter(f => f.type === 'application/pdf');
        const others = accepted.filter(f => f.type !== 'application/pdf');

        const next = others.map(f => ({
            id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            file: f,
            kind: inferKind(f.type),
            previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
            sourcePdf: null,
        }));

        // PDFs are never uploaded to Gemini directly: we extract text + embedded photos client-side.
        // Sending the PDF binary AND the extracted photos doubled the payload and tripped CPU limits.
        // The photos are also needed locally for invenio_photos rows on commit.
        setFiles(prev => [...prev, ...next]);

        if (pdfs.length) {
            setExtractingPdf(true);
            try {
                for (const pdf of pdfs) {
                    try {
                        const photos = await extractPhotosFromPdf(pdf);
                        if (photos.length) {
                            const extracted = photos.map(p => ({
                                id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                                file: p,
                                kind: 'image',
                                previewUrl: URL.createObjectURL(p),
                                sourcePdf: pdf.name,
                            }));
                            setFiles(prev => [...prev, ...extracted]);
                        }
                    } catch (e) {
                        console.warn('PDF photo extraction failed', e);
                    }
                    try {
                        const txt = await extractTextFromPdf(pdf);
                        if (txt.trim()) {
                            setText(prev => {
                                const header = `\n\n=== ${pdf.name} (extracted text, ${(pdf.size / 1024 / 1024).toFixed(1)} MB) ===\n`;
                                return (prev || '') + header + txt;
                            });
                        }
                    } catch (e) {
                        console.warn('PDF text extraction failed', e);
                        setError(`PDF "${pdf.name}" text extraction failed. ${e.message}`);
                    }
                }
            } finally {
                setExtractingPdf(false);
            }
        }
    }, []);

    const onDrop = useCallback((accepted, rejected) => {
        if (rejected?.length) {
            setError(rejected.map(r => `${r.file.name}: ${r.errors.map(e => e.message).join(', ')}`).join(' | '));
        }
        addFiles(accepted);
    }, [addFiles]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: ALLOWED_INGEST_MIME.reduce((acc, t) => ({ ...acc, [t]: [] }), {}),
        multiple: true,
    });

    const removeFile = id => {
        setFiles(prev => {
            const target = prev.find(f => f.id === id);
            if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
            return prev.filter(f => f.id !== id);
        });
    };

    const totalBytes = useMemo(
        () => files.reduce((s, f) => s + (f.file?.size || 0), 0),
        [files],
    );

    const handleExtract = async () => {
        setError(null);
        if (!text.trim() && files.length === 0) {
            setError('Provide a description or upload at least one file.');
            return;
        }
        setStep('extracting');
        try {
            const uploadResult = files.length
                ? await uploadIngestFiles(files.map(f => f.file), { userId: user.id })
                : { jobId: null, files: [] };

            const { jobId: extractJobId, extracted: ex, confidence: conf, groundingSources: sources } = await extractBoat({
                text,
                files: uploadResult.files.map(f => ({ path: f.path, mime: f.mime, kind: f.kind })),
                jobId: uploadResult.jobId,
                wantMarketingDescription: wantMarketing,
            });

            setJobId(extractJobId);
            setExtracted(ex);
            setConfidence(conf);
            setGroundingSources(sources || []);

            const filled = {};
            const ai = new Set();
            for (const k of FIELDS) {
                if (ex[k] !== undefined && ex[k] !== null && ex[k] !== '') {
                    filled[k] = ex[k];
                    ai.add(k);
                }
            }
            filled.features = Array.isArray(ex.features) ? ex.features : [];
            if (filled.features.length) ai.add('features');
            setForm(filled);
            setAiFields(ai);

            // Photo previews — match descriptions by file_index against image files.
            const photoFiles = uploadResult.files.filter(f => f.kind === 'image');
            const descriptions = Array.isArray(ex.photo_descriptions) ? ex.photo_descriptions : [];
            const localImages = files.filter(f => f.kind === 'image');
            const photoState = photoFiles.map((f, idx) => {
                const desc = descriptions.find(d => d.file_index === idx);
                return {
                    path: f.path,
                    name: f.name,
                    previewUrl: localImages[idx]?.previewUrl || null,
                    caption: desc?.caption || '',
                    is_cover: !!desc?.is_cover,
                };
            });
            if (photoState.length && !photoState.some(p => p.is_cover)) photoState[0].is_cover = true;
            setPhotos(photoState);

            // Seed seasonal rates from Gemini's extracted price table.
            if (Array.isArray(ex.seasonal_prices) && ex.seasonal_prices.length) {
                setSeasonalRates(ex.seasonal_prices.map((r, i) => ({
                    id: `ai_${i}_${Date.now()}`,
                    start_date: r.start_date,
                    end_date: r.end_date,
                    amount: Number(r.amount),
                    minimum_nights: r.minimum_nights || 1,
                    allowed_checkin_days: 'Flexible check in days',
                    _ai: true,
                })));
            }

            setStep('preview');
        } catch (err) {
            console.error(err);
            setError(err.message || String(err));
            setStep('intake');
        }
    };

    const handleField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
    const setCover = idx => setPhotos(prev => prev.map((p, i) => ({ ...p, is_cover: i === idx })));
    const setCaption = (idx, caption) => setPhotos(prev => prev.map((p, i) => (i === idx ? { ...p, caption } : p)));

    const handleAddRate = (rateObj) => {
        const queued = {
            id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            start_date: rateObj.start_date,
            end_date: rateObj.end_date,
            amount: parseFloat(rateObj.amount),
            minimum_nights: parseInt(rateObj.minimum_nights, 10) || 1,
            allowed_checkin_days: rateObj.allowed_checkin_days || 'Flexible check in days',
        };
        setSeasonalRates(prev => [...prev, queued].sort((a, b) => new Date(a.start_date) - new Date(b.start_date)));
    };

    const handleDeleteRate = (rate) => {
        setSeasonalRates(prev => prev.filter(r => r.id !== rate.id));
    };

    const handleCommit = async () => {
        setError(null);
        if (!form.boat_name?.trim()) {
            setError('Boat name required.');
            return;
        }
        setStep('committing');
        try {
            const result = await commitBoat({
                jobId,
                edited: {
                    ...form,
                    features: form.features || [],
                    marketing_sources: groundingSources,
                    photos: photos.map(p => ({ path: p.path, caption: p.caption, is_cover: p.is_cover })),
                    seasonal_rates: seasonalRates.map(({ id, _ai, ...rest }) => rest),
                },
            });
            if (result?.rates_error) {
                setError(`Boat saved but seasonal rates failed: ${result.rates_error}. Add them manually from Edit.`);
                setStep('preview');
                return;
            }
            onSaved?.(result);
            onClose?.();
        } catch (err) {
            console.error(err);
            setError(err.message || String(err));
            setStep('preview');
        }
    };

    const toggleFeature = (label) => {
        const list = form.features || [];
        if (list.includes(label)) {
            handleField('features', list.filter(f => f !== label));
        } else {
            handleField('features', [...list, label]);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="bg-surface border border-border rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
                {/* Header */}
                <div className="flex items-center gap-4 p-6 border-b border-border">
                    <div className="w-12 h-12 rounded-xl bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined notranslate text-2xl">auto_awesome</span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-lg font-bold text-text-primary truncate">Add Boat with AI</h2>
                        <p className="text-xs text-text-muted mt-0.5 truncate">
                            {step === 'intake' && 'Describe the vessel or attach files (photos, brochure PDF, audio).'}
                            {step === 'extracting' && 'Extracting with Gemini multimodal…'}
                            {step === 'preview' && 'Review and edit AI-extracted data, then save.'}
                            {step === 'committing' && 'Saving…'}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={step === 'extracting' || step === 'committing'}
                        className="p-2 text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-lg transition-colors disabled:opacity-40"
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

                    {step === 'intake' && (
                        <>
                            <div>
                                <label className="block text-xs text-text-muted mb-1.5 font-medium">Description / notes (optional)</label>
                                <textarea
                                    className="input-theme w-full resize-none"
                                    rows={5}
                                    placeholder="e.g. Sunseeker Predator 60, 2022, 4 cabins, daily €5000, base port Marina Botafoch..."
                                    value={text}
                                    onChange={e => setText(e.target.value)}
                                />
                            </div>

                            <div>
                                <div
                                    {...getRootProps()}
                                    className={`border-2 border-dashed rounded-xl transition-all p-8 text-center cursor-pointer ${
                                        isDragActive
                                            ? 'border-primary bg-primary/10 scale-[1.01]'
                                            : 'border-border hover:border-primary/50 hover:bg-surface-2'
                                    }`}
                                >
                                    <input {...getInputProps()} />
                                    <span className="material-symbols-outlined notranslate text-4xl text-text-muted">cloud_upload</span>
                                    <p className="text-sm font-medium text-text-primary mt-2">
                                        {isDragActive ? 'Drop files here' : 'Drag files or click to select'}
                                    </p>
                                    <p className="text-[10px] text-text-muted mt-1">
                                        Photos (JPG/PNG/WEBP), PDF brochures, audio (MP3/WAV/M4A), text · 18 MB total
                                    </p>
                                </div>

                                {extractingPdf && (
                                    <p className="text-[11px] text-primary mt-2 flex items-center gap-2">
                                        <span className="material-symbols-outlined notranslate text-sm animate-spin">progress_activity</span>
                                        Extracting photos from PDF…
                                    </p>
                                )}

                                {files.length > 0 && (
                                    <div className="mt-3 space-y-2">
                                        <p className="text-[10px] text-text-muted">
                                            {files.length} file · {(totalBytes / 1024 / 1024).toFixed(1)} MB
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                            {files.map(f => (
                                                <div key={f.id} className="flex items-center gap-2 p-2 bg-surface-2 rounded-lg border border-border">
                                                    {f.previewUrl ? (
                                                        <img src={f.previewUrl} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                                                    ) : (
                                                        <span className="material-symbols-outlined notranslate text-2xl text-text-muted flex-shrink-0">{KIND_ICON[f.kind]}</span>
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs text-text-primary truncate">{f.file.name}</p>
                                                        <p className="text-[10px] text-text-muted">
                                                            {(f.file.size / 1024).toFixed(0)} KB
                                                            {f.sourcePdf && <span className="ml-1 text-primary">· from {f.sourcePdf}</span>}
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={() => removeFile(f.id)}
                                                        className="p-1 text-text-muted hover:text-red-400 transition-colors"
                                                    >
                                                        <span className="material-symbols-outlined notranslate text-[16px]">close</span>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="accent-primary"
                                    checked={wantMarketing}
                                    onChange={e => setWantMarketing(e.target.checked)}
                                />
                                Generate marketing description with web search
                                <span className="text-[10px] text-text-muted/70">(uses Google Search grounding when manufacturer + model known)</span>
                            </label>
                        </>
                    )}

                    {step === 'extracting' && (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <span className="material-symbols-outlined notranslate text-5xl text-primary animate-pulse">auto_awesome</span>
                            <p className="text-sm text-text-primary font-medium">Analysing…</p>
                            <p className="text-[11px] text-text-muted text-center max-w-xs">
                                Gemini is reading specs, dimensions, prices and features.
                            </p>
                        </div>
                    )}

                    {step === 'preview' && extracted && (
                        <>
                            {confidence !== null && (
                                <div className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                                    confidence >= 0.7
                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                                        : confidence >= 0.4
                                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                                        : 'bg-red-500/10 border-red-500/30 text-red-400'
                                }`}>
                                    <span className="material-symbols-outlined notranslate text-[16px]">
                                        {confidence >= 0.7 ? 'check_circle' : 'warning'}
                                    </span>
                                    Extraction confidence: {Math.round(confidence * 100)}%. Review fields carefully before saving.
                                </div>
                            )}

                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Identity</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <Field label="Boat name *" value={form.boat_name} onChange={v => handleField('boat_name', v)} aiHighlight={aiFields.has('boat_name')} fullWidth />
                                    <Field label="Manufacturer" value={form.manufacturer} onChange={v => handleField('manufacturer', v)} aiHighlight={aiFields.has('manufacturer')} />
                                    <Field label="Model" value={form.model} onChange={v => handleField('model', v)} aiHighlight={aiFields.has('model')} />
                                    <Field label="Year" type="number" value={form.year} onChange={v => handleField('year', v)} aiHighlight={aiFields.has('year')} />
                                    <div>
                                        <label className="block text-xs text-text-muted mb-1.5 font-medium">
                                            Type {aiFields.has('type') && <AiBadge />}
                                        </label>
                                        <select
                                            className="input-theme w-full"
                                            value={form.type || 'Motor'}
                                            onChange={e => handleField('type', e.target.value)}
                                        >
                                            <option value="Motor">Motor</option>
                                            <option value="Sail">Sail</option>
                                            <option value="Catamaran">Catamaran</option>
                                            <option value="Superyacht">Superyacht</option>
                                        </select>
                                    </div>
                                    <Field label="Tagline" value={form.tagline} onChange={v => handleField('tagline', v)} aiHighlight={aiFields.has('tagline')} fullWidth />
                                    <Field label="Registration" value={form.registration_number} onChange={v => handleField('registration_number', v)} aiHighlight={aiFields.has('registration_number')} />
                                    <Field label="Base port" value={form.base_port} onChange={v => handleField('base_port', v)} aiHighlight={aiFields.has('base_port')} />
                                </div>
                            </div>

                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Dimensions & Capacity</p>
                                <div className="grid grid-cols-3 gap-4">
                                    <Field label="Length (ft)" type="number" value={form.length_ft} onChange={v => handleField('length_ft', v)} aiHighlight={aiFields.has('length_ft')} />
                                    <Field label="Beam (ft)" type="number" value={form.beam_ft} onChange={v => handleField('beam_ft', v)} aiHighlight={aiFields.has('beam_ft')} />
                                    <Field label="Draft (ft)" type="number" value={form.draft_ft} onChange={v => handleField('draft_ft', v)} aiHighlight={aiFields.has('draft_ft')} />
                                    <Field label="Pax (day)" type="number" value={form.guest_capacity_day} onChange={v => handleField('guest_capacity_day', v)} aiHighlight={aiFields.has('guest_capacity_day')} />
                                    <Field label="Pax (sleeps)" type="number" value={form.guest_capacity_overnight} onChange={v => handleField('guest_capacity_overnight', v)} aiHighlight={aiFields.has('guest_capacity_overnight')} />
                                    <Field label="Cabins" type="number" value={form.cabins} onChange={v => handleField('cabins', v)} aiHighlight={aiFields.has('cabins')} />
                                    <Field label="Bathrooms" type="number" value={form.bathrooms} onChange={v => handleField('bathrooms', v)} aiHighlight={aiFields.has('bathrooms')} />
                                </div>
                            </div>

                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Pricing & Policy</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <Field label="Daily price (€)" type="number" value={form.daily_price} onChange={v => handleField('daily_price', v)} aiHighlight={aiFields.has('daily_price')} />
                                    <Field label="Weekly price (€)" type="number" value={form.weekly_price} onChange={v => handleField('weekly_price', v)} aiHighlight={aiFields.has('weekly_price')} />
                                    <Field label="Security deposit (€)" type="number" value={form.security_deposit} onChange={v => handleField('security_deposit', v)} aiHighlight={aiFields.has('security_deposit')} />
                                    <Field label="Cleaning fee (€)" type="number" value={form.cleaning_fee} onChange={v => handleField('cleaning_fee', v)} aiHighlight={aiFields.has('cleaning_fee')} />
                                    <div>
                                        <label className="block text-xs text-text-muted mb-1.5 font-medium">
                                            Skipper {aiFields.has('skipper_type') && <AiBadge />}
                                        </label>
                                        <select
                                            className="input-theme w-full"
                                            value={form.skipper_type || 'Required'}
                                            onChange={e => handleField('skipper_type', e.target.value)}
                                        >
                                            <option value="Required">Required</option>
                                            <option value="Optional">Optional</option>
                                            <option value="Bareboat">Bareboat</option>
                                        </select>
                                    </div>
                                    <label className="col-span-2 flex items-center gap-2 cursor-pointer p-3 bg-surface-2 rounded-lg border border-border">
                                        <input
                                            type="checkbox"
                                            className="accent-primary"
                                            checked={!!form.price_locked}
                                            onChange={e => handleField('price_locked', e.target.checked)}
                                        />
                                        <span className="text-xs text-text-primary">
                                            <span className="font-bold">Lock price for agents</span>
                                            <span className="text-text-muted ml-2">— agents cannot apply mark-up or manual override; quote price = listing price</span>
                                        </span>
                                    </label>
                                    <div>
                                        <label className="block text-xs text-text-muted mb-1.5 font-medium">
                                            Fuel policy {aiFields.has('fuel_policy') && <AiBadge />}
                                        </label>
                                        <select
                                            className="input-theme w-full"
                                            value={form.fuel_policy || 'Paid by Consumption'}
                                            onChange={e => handleField('fuel_policy', e.target.value)}
                                        >
                                            <option value="Paid by Consumption">Paid by Consumption</option>
                                            <option value="Full to Full">Full to Full</option>
                                            <option value="Included">Included</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Seasonal pricing — calendar (pre-commit, held in memory) */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-widest text-primary flex items-center gap-2">
                                        <span className="material-symbols-outlined notranslate text-sm">calendar_month</span>
                                        Seasonal Pricing (Daily)
                                        {seasonalRates.some(r => r._ai) && <AiBadge />}
                                    </p>
                                    {seasonalRates.length > 0 && (
                                        <span className="text-[10px] text-amber-400 font-black uppercase tracking-widest">
                                            {seasonalRates.length} rate{seasonalRates.length > 1 ? 's' : ''} pending boat save
                                        </span>
                                    )}
                                </div>
                                <SeasonalPricingCalendar
                                    rates={seasonalRates}
                                    onAddRate={handleAddRate}
                                    onDeleteRate={handleDeleteRate}
                                    monthsAhead={12}
                                />
                            </div>

                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">
                                    Features {aiFields.has('features') && <AiBadge />}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {(form.features || []).map(f => (
                                        <span key={f} className="flex items-center gap-1.5 px-3 py-1 bg-primary/10 border border-primary/20 rounded-full text-[11px] font-bold text-primary">
                                            {f}
                                            <button onClick={() => toggleFeature(f)} className="hover:text-text-primary">
                                                <span className="material-symbols-outlined notranslate text-[14px]">close</span>
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Description</p>
                                <Field label="Detailed description" value={form.description} onChange={v => handleField('description', v)} aiHighlight={aiFields.has('description')} textarea fullWidth />
                                {groundingSources.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        <span className="text-[10px] text-text-muted">Sources:</span>
                                        {groundingSources.map((s, i) => (
                                            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                                               className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary rounded-full hover:bg-primary/20 transition-colors">
                                                {s.title}
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {photos.length > 0 && (
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">
                                        Photos ({photos.length}) — click ★ for cover
                                    </p>
                                    <div className="grid grid-cols-3 gap-3">
                                        {photos.map((p, idx) => (
                                            <div
                                                key={p.path}
                                                className={`relative rounded-xl overflow-hidden bg-surface-2 aspect-video ${
                                                    p.is_cover ? 'border-2 border-primary shadow-lg shadow-primary/20' : 'border border-border'
                                                }`}
                                            >
                                                {p.previewUrl
                                                    ? <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                                                    : <div className="w-full h-full flex items-center justify-center text-text-muted text-xs">{p.name}</div>}
                                                <button
                                                    type="button"
                                                    onClick={() => setCover(idx)}
                                                    className={`absolute top-2 left-2 px-2 py-0.5 text-[9px] font-bold uppercase rounded-full shadow ${
                                                        p.is_cover ? 'bg-primary text-white' : 'bg-black/60 text-white hover:bg-primary'
                                                    }`}
                                                >
                                                    {p.is_cover ? '★ Cover' : '☆ Cover'}
                                                </button>
                                                <input
                                                    type="text"
                                                    value={p.caption}
                                                    onChange={e => setCaption(idx, e.target.value)}
                                                    placeholder="Caption"
                                                    className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-2 py-1 border-0 outline-none"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {step === 'committing' && (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <span className="material-symbols-outlined notranslate text-5xl text-primary animate-spin">progress_activity</span>
                            <p className="text-sm text-text-primary font-medium">Saving boat + photos + rates…</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-border flex justify-end gap-3">
                    {step === 'intake' && (
                        <>
                            <button onClick={onClose} className="px-5 py-2.5 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary transition-all">
                                Cancel
                            </button>
                            <button
                                onClick={handleExtract}
                                disabled={(!text.trim() && files.length === 0) || extractingPdf}
                                className="btn-primary text-sm disabled:opacity-50 flex items-center gap-2"
                            >
                                <span className="material-symbols-outlined notranslate text-[16px]">auto_awesome</span>
                                Extract data
                            </button>
                        </>
                    )}
                    {step === 'preview' && (
                        <>
                            <button onClick={() => setStep('intake')} className="px-5 py-2.5 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary transition-all">
                                Back
                            </button>
                            <button onClick={handleCommit} className="btn-primary text-sm flex items-center gap-2">
                                <span className="material-symbols-outlined notranslate text-[16px]">save</span>
                                Save boat
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
