import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { useAuth } from '../contexts/AuthContext';
import {
    uploadIngestFiles,
    extractProperty,
    commitProperty,
    ALLOWED_INGEST_MIME,
} from '../lib/propertyIngestApi';
import { extractPhotosFromPdf, extractTextFromPdf } from '../lib/pdfPhotoExtract';
import FeatureCategoryGrid from './FeatureCategoryGrid';
import SeasonalPricingCalendar from './SeasonalPricingCalendar';

const KIND_ICON = {
    image: 'image',
    pdf: 'description',
    audio: 'mic',
    video: 'movie',
    text: 'article',
};

const RENTAL_TYPE_LABELS = {
    daily: 'Giornaliero / Settimanale',
    monthly: 'Mensile (mid-term)',
    seasonal: 'Stagionale',
    annual: 'Annuale (long-term)',
};
const RENTAL_TYPE_KEYS = ['daily', 'monthly', 'seasonal', 'annual'];

function inferKind(mime) {
    if (!mime) return 'text';
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf') return 'pdf';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    return 'text';
}

const AiBadge = () => (
    <span
        title="Estratto da AI — verifica e correggi se necessario"
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
                rows={3}
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

export default function PropertyIngestModal({ onClose, onSaved }) {
    const { user } = useAuth();
    const [step, setStep] = useState('intake'); // intake | extracting | preview | committing
    const [text, setText] = useState('');
    const [files, setFiles] = useState([]); // [{ id, file, previewUrl, kind }]
    const [error, setError] = useState(null);
    const [jobId, setJobId] = useState(null);
    const [uploaded, setUploaded] = useState([]); // refs from uploadIngestFiles
    const [extracted, setExtracted] = useState(null);
    const [aiFields, setAiFields] = useState(new Set());
    const [form, setForm] = useState({});
    const [photos, setPhotos] = useState([]); // [{ path, name, previewUrl, caption, is_cover }]
    const [videoRefs, setVideoRefs] = useState([]); // [{ path, name, previewUrl, caption }]
    const [rentalTypeConfigs, setRentalTypeConfigs] = useState({});
    const [seasonalRates, setSeasonalRates] = useState([]);
    const [confidence, setConfidence] = useState(null);

    useEffect(() => () => {
        files.forEach(f => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
        photos.forEach(p => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
        videoRefs.forEach(v => v.previewUrl && URL.revokeObjectURL(v.previewUrl));
    }, []); // eslint-disable-line

    const onDrop = useCallback((accepted, rejected) => {
        if (rejected?.length) {
            setError(rejected.map(r => `${r.file.name}: ${r.errors.map(e => e.message).join(', ')}`).join(' | '));
        }
        const next = accepted.map(f => ({
            id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            file: f,
            kind: inferKind(f.type),
            previewUrl: (f.type.startsWith('image/') || f.type.startsWith('video/'))
                ? URL.createObjectURL(f)
                : null,
        }));
        setFiles(prev => [...prev, ...next]);
    }, []);

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
            setError('Inserisci una descrizione o carica almeno un file.');
            return;
        }
        setStep('extracting');
        try {
            // Pre-process PDFs client-side: extract embedded images into the gallery queue
            // and pull text into the prompt, then drop the PDF itself from the upload set.
            // This keeps the 18 MB Gemini inline budget free for richer image analysis and
            // ensures source photos land in property_photos at commit.
            let augmentedText = text;
            const pdfDerivedFiles = [];
            const nonPdfSourceFiles = [];
            for (const entry of files) {
                if (entry.kind === 'pdf') {
                    try {
                        const [photos, pdfText] = await Promise.all([
                            extractPhotosFromPdf(entry.file),
                            extractTextFromPdf(entry.file),
                        ]);
                        for (const photo of photos) {
                            pdfDerivedFiles.push({
                                id: `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                                file: photo,
                                kind: 'image',
                                previewUrl: URL.createObjectURL(photo),
                            });
                        }
                        if (pdfText && pdfText.trim()) {
                            augmentedText = `${augmentedText ? augmentedText + '\n\n' : ''}--- PDF TEXT (${entry.file.name}) ---\n${pdfText}`;
                        }
                    } catch (e) {
                        console.error('PDF preprocess failed', entry.file.name, e);
                        nonPdfSourceFiles.push(entry); // fall back to raw PDF upload
                    }
                } else {
                    nonPdfSourceFiles.push(entry);
                }
            }

            const uploadSet = [...nonPdfSourceFiles, ...pdfDerivedFiles];

            // Expose PDF-derived images in the local file panel so previews work after extract.
            if (pdfDerivedFiles.length) {
                setFiles(prev => [...prev, ...pdfDerivedFiles]);
            }

            // Upload files first.
            const uploadResult = uploadSet.length
                ? await uploadIngestFiles(uploadSet.map(f => f.file), { userId: user.id })
                : { jobId: null, files: [] };

            const { jobId: extractJobId, extracted: ex, confidence: conf } = await extractProperty({
                text: augmentedText,
                files: uploadResult.files.map(f => ({ path: f.path, mime: f.mime, kind: f.kind })),
                jobId: uploadResult.jobId,
            });

            setJobId(extractJobId);
            setUploaded(uploadResult.files);
            setExtracted(ex);
            setConfidence(conf);

            // Build form state from extracted (only fields the AI provided).
            const filled = {};
            const ai = new Set();
            const FIELDS = [
                'villa_name', 'property_type', 'areaname', 'district',
                'bedrooms', 'bathrooms', 'sleeps', 'minimum_nights',
                'minimum_price', 'maximum_price', 'cleaning_charge', 'deposit',
                'tagline', 'description', 'license', 'gps', 'allow_shortstays',
            ];
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

            // Build photo previews — match photo_descriptions by file_index against image files.
            // `uploadSet` is the in-handler authoritative list (state `files` does not yet
            // include PDF-derived images at this point because setFiles is async).
            const photoFiles = uploadResult.files.filter(f => f.kind === 'image');
            const descriptions = Array.isArray(ex.photo_descriptions) ? ex.photo_descriptions : [];
            const localImages = uploadSet.filter(f => f.kind === 'image');
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
            // Ensure exactly one cover (first one if AI didn't pick).
            if (photoState.length && !photoState.some(p => p.is_cover)) photoState[0].is_cover = true;
            setPhotos(photoState);

            // Build video refs (uploaded videos go to property_videos at commit).
            const remoteVideos = uploadResult.files.filter(f => f.kind === 'video');
            const localVideos = uploadSet.filter(f => f.kind === 'video');
            setVideoRefs(remoteVideos.map((f, idx) => ({
                path: f.path,
                name: f.name,
                previewUrl: localVideos[idx]?.previewUrl || null,
                caption: '',
            })));

            // Seed rental_type_configs from extraction.
            setRentalTypeConfigs(ex.rental_type_configs && typeof ex.rental_type_configs === 'object'
                ? ex.rental_type_configs
                : {});
            if (ex.rental_type_configs && Object.keys(ex.rental_type_configs).length) {
                setAiFields(prev => new Set([...prev, 'rental_type_configs']));
            }

            // Seed seasonal rates from extraction.
            if (Array.isArray(ex.seasonal_prices) && ex.seasonal_prices.length) {
                setSeasonalRates(ex.seasonal_prices.map((r, i) => ({
                    id: `ai_${i}_${Date.now()}`,
                    start_date: r.start_date,
                    end_date: r.end_date,
                    amount: Number(r.amount),
                    minimum_nights: r.minimum_nights || 7,
                    allowed_checkin_days: 'Flexible check in days',
                    _ai: true,
                })));
            } else {
                setSeasonalRates([]);
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
    const setVideoCaption = (idx, caption) => setVideoRefs(prev => prev.map((v, i) => (i === idx ? { ...v, caption } : v)));

    const toggleRentalType = (key) => {
        setRentalTypeConfigs(prev => {
            const cur = prev[key] || {};
            return { ...prev, [key]: { ...cur, enabled: !cur.enabled } };
        });
    };
    const setRentalTypicalPrice = (key, val) => {
        setRentalTypeConfigs(prev => {
            const cur = prev[key] || { enabled: true };
            const num = val === '' ? undefined : parseFloat(val);
            const next = { ...cur };
            if (num === undefined || Number.isNaN(num)) delete next.typical_price;
            else next.typical_price = num;
            return { ...prev, [key]: next };
        });
    };

    const handleAddRate = (rateObj) => {
        const queued = {
            id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            start_date: rateObj.start_date,
            end_date: rateObj.end_date,
            amount: parseFloat(rateObj.amount),
            minimum_nights: parseInt(rateObj.minimum_nights, 10) || 7,
            allowed_checkin_days: rateObj.allowed_checkin_days || 'Flexible check in days',
        };
        setSeasonalRates(prev => [...prev, queued].sort((a, b) => new Date(a.start_date) - new Date(b.start_date)));
    };
    const handleDeleteRate = (rate) => {
        setSeasonalRates(prev => prev.filter(r => r.id !== rate.id));
    };

    const handleCommit = async () => {
        setError(null);
        if (!form.villa_name?.trim()) {
            setError('Nome proprietà obbligatorio.');
            return;
        }
        setStep('committing');
        try {
            const result = await commitProperty({
                jobId,
                edited: {
                    ...form,
                    rental_type_configs: rentalTypeConfigs,
                    photos: photos.map(p => ({ path: p.path, caption: p.caption, is_cover: p.is_cover })),
                    videos: videoRefs.map(v => ({ path: v.path, caption: v.caption })),
                    seasonal_rates: seasonalRates.map(({ id, _ai, ...rest }) => rest),
                },
            });
            onSaved?.(result);
            onClose?.();
        } catch (err) {
            console.error(err);
            setError(err.message || String(err));
            setStep('preview');
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
                        <h2 className="text-lg font-bold text-text-primary truncate">Aggiungi proprietà con AI</h2>
                        <p className="text-xs text-text-muted mt-0.5 truncate">
                            {step === 'intake' && 'Descrivi la proprietà o allega file (foto, PDF, audio).'}
                            {step === 'extracting' && 'Estrazione in corso con Gemini multimodale...'}
                            {step === 'preview' && 'Verifica e modifica i dati estratti, poi salva.'}
                            {step === 'committing' && 'Salvataggio in corso...'}
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
                                <label className="block text-xs text-text-muted mb-1.5 font-medium">Descrizione (opzionale)</label>
                                <textarea
                                    className="input-theme w-full resize-none"
                                    rows={5}
                                    placeholder="Es: Villa Can Pep, Santa Eulalia, 5 camere, 4 bagni, vista mare, piscina infinity, 800-1200€/notte..."
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
                                        {isDragActive ? 'Rilascia qui i file' : 'Trascina file o clicca per selezionare'}
                                    </p>
                                    <p className="text-[10px] text-text-muted mt-1">
                                        Foto (JPG/PNG/WEBP/HEIC), PDF, audio (MP3/WAV/M4A/AAC/FLAC), video (MP4/MOV/WEBM), testo · max 18 MB totali
                                    </p>
                                </div>

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
                                                        <p className="text-[10px] text-text-muted">{(f.file.size / 1024).toFixed(0)} KB</p>
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
                        </>
                    )}

                    {step === 'extracting' && (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <span className="material-symbols-outlined notranslate text-5xl text-primary animate-pulse">auto_awesome</span>
                            <p className="text-sm text-text-primary font-medium">Analisi in corso...</p>
                            <p className="text-[11px] text-text-muted text-center max-w-xs">
                                Gemini sta estraendo nome, camere, prezzi, tipologie di affitto, dotazioni e altri dettagli da testo, foto, PDF, audio e video.
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
                                    Confidenza estrazione: {Math.round(confidence * 100)}%. Verifica attentamente i campi prima di salvare.
                                </div>
                            )}

                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Identità</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <Field label="Nome proprietà *" value={form.villa_name} onChange={v => handleField('villa_name', v)} aiHighlight={aiFields.has('villa_name')} fullWidth />
                                    <Field label="Tagline" value={form.tagline} onChange={v => handleField('tagline', v)} aiHighlight={aiFields.has('tagline')} fullWidth />
                                    <div className="col-span-2">
                                        <label className="block text-xs text-text-muted mb-1.5 font-medium">
                                            Tipo {aiFields.has('property_type') && <AiBadge />}
                                        </label>
                                        <select
                                            className="input-theme w-full"
                                            value={form.property_type || 'villa'}
                                            onChange={e => handleField('property_type', e.target.value)}
                                        >
                                            <option value="villa">Villa</option>
                                            <option value="apartment">Appartamento</option>
                                        </select>
                                    </div>
                                    <Field label="Area / Quartiere" value={form.areaname} onChange={v => handleField('areaname', v)} aiHighlight={aiFields.has('areaname')} />
                                    <Field label="Comune" value={form.district} onChange={v => handleField('district', v)} aiHighlight={aiFields.has('district')} />
                                    <Field label="Licenza turistica" value={form.license} onChange={v => handleField('license', v)} aiHighlight={aiFields.has('license')} />
                                    <Field label="GPS (lat,lng)" value={form.gps} onChange={v => handleField('gps', v)} aiHighlight={aiFields.has('gps')} />
                                </div>
                            </div>

                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Capacità</p>
                                <div className="grid grid-cols-3 gap-4">
                                    <Field label="Camere" value={form.bedrooms} onChange={v => handleField('bedrooms', v)} aiHighlight={aiFields.has('bedrooms')} type="number" />
                                    <Field label="Bagni" value={form.bathrooms} onChange={v => handleField('bathrooms', v)} aiHighlight={aiFields.has('bathrooms')} type="number" />
                                    <Field label="Posti letto" value={form.sleeps} onChange={v => handleField('sleeps', v)} aiHighlight={aiFields.has('sleeps')} type="number" />
                                </div>
                            </div>

                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Prezzi (€)</p>
                                <div className="grid grid-cols-4 gap-4">
                                    <Field label="Min" value={form.minimum_price} onChange={v => handleField('minimum_price', v)} aiHighlight={aiFields.has('minimum_price')} type="number" />
                                    <Field label="Max" value={form.maximum_price} onChange={v => handleField('maximum_price', v)} aiHighlight={aiFields.has('maximum_price')} type="number" />
                                    <Field label="Pulizia" value={form.cleaning_charge} onChange={v => handleField('cleaning_charge', v)} aiHighlight={aiFields.has('cleaning_charge')} type="number" />
                                    <Field label="Cauzione" value={form.deposit} onChange={v => handleField('deposit', v)} aiHighlight={aiFields.has('deposit')} type="number" />
                                </div>
                            </div>

                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Politiche</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <Field label="Notti minime" value={form.minimum_nights} onChange={v => handleField('minimum_nights', v)} aiHighlight={aiFields.has('minimum_nights')} type="number" />
                                    <div>
                                        <label className="block text-xs text-text-muted mb-1.5 font-medium">
                                            Soggiorni brevi {aiFields.has('allow_shortstays') && <AiBadge />}
                                        </label>
                                        <select
                                            className="input-theme w-full"
                                            value={form.allow_shortstays || 'no'}
                                            onChange={e => handleField('allow_shortstays', e.target.value)}
                                        >
                                            <option value="no">No</option>
                                            <option value="yes">Sì</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3 flex items-center gap-2">
                                    Tipologie di affitto
                                    {aiFields.has('rental_type_configs') && <AiBadge />}
                                </p>
                                <div className="grid grid-cols-2 gap-3">
                                    {RENTAL_TYPE_KEYS.map(key => {
                                        const cfg = rentalTypeConfigs[key] || {};
                                        return (
                                            <div
                                                key={key}
                                                className={`p-3 rounded-lg border ${
                                                    cfg.enabled
                                                        ? 'border-primary/40 bg-primary/5'
                                                        : 'border-border bg-surface-2/40'
                                                }`}
                                            >
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        className="accent-primary"
                                                        checked={!!cfg.enabled}
                                                        onChange={() => toggleRentalType(key)}
                                                    />
                                                    <span className="text-xs font-medium text-text-primary">
                                                        {RENTAL_TYPE_LABELS[key]}
                                                    </span>
                                                </label>
                                                {cfg.enabled && (
                                                    <div className="mt-2">
                                                        <label className="block text-[10px] text-text-muted mb-1">
                                                            Prezzo indicativo (€)
                                                            {key === 'daily' && ' / notte'}
                                                            {key === 'monthly' && ' / mese'}
                                                            {key === 'seasonal' && ' / stagione'}
                                                            {key === 'annual' && ' / anno'}
                                                        </label>
                                                        <input
                                                            type="number"
                                                            className="input-theme w-full text-xs"
                                                            value={cfg.typical_price ?? ''}
                                                            onChange={e => setRentalTypicalPrice(key, e.target.value)}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-widest text-primary flex items-center gap-2">
                                        <span className="material-symbols-outlined notranslate text-sm">calendar_month</span>
                                        Prezzi stagionali (per notte)
                                        {seasonalRates.some(r => r._ai) && <AiBadge />}
                                    </p>
                                    {seasonalRates.length > 0 && (
                                        <span className="text-[10px] text-amber-400 font-black uppercase tracking-widest">
                                            {seasonalRates.length} {seasonalRates.length > 1 ? 'tariffe' : 'tariffa'} pendenti
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
                                    Dotazioni {aiFields.has('features') && <AiBadge />}
                                </p>
                                <FeatureCategoryGrid
                                    selected={form.features || []}
                                    onChange={list => handleField('features', list)}
                                />
                            </div>

                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">Descrizione</p>
                                <Field label="Descrizione dettagliata" value={form.description} onChange={v => handleField('description', v)} aiHighlight={aiFields.has('description')} textarea fullWidth />
                            </div>

                            {videoRefs.length > 0 && (
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">
                                        Video ({videoRefs.length})
                                    </p>
                                    <div className="grid grid-cols-2 gap-3">
                                        {videoRefs.map((v, idx) => (
                                            <div key={v.path} className="rounded-xl overflow-hidden bg-surface-2 border border-border">
                                                {v.previewUrl ? (
                                                    <video
                                                        src={v.previewUrl}
                                                        controls
                                                        className="w-full aspect-video bg-black"
                                                    />
                                                ) : (
                                                    <div className="w-full aspect-video flex items-center justify-center text-text-muted text-xs gap-1.5">
                                                        <span className="material-symbols-outlined notranslate text-base">movie</span>
                                                        {v.name}
                                                    </div>
                                                )}
                                                <input
                                                    type="text"
                                                    value={v.caption}
                                                    onChange={e => setVideoCaption(idx, e.target.value)}
                                                    placeholder="Didascalia"
                                                    className="w-full bg-surface text-[11px] px-2 py-1.5 border-t border-border outline-none"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {photos.length > 0 && (
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">
                                        Foto ({photos.length}) — clicca ★ per impostare cover
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
                                                    placeholder="Didascalia"
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
                            <p className="text-sm text-text-primary font-medium">Salvataggio + generazione embedding...</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-border flex justify-end gap-3">
                    {step === 'intake' && (
                        <>
                            <button onClick={onClose} className="px-5 py-2.5 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary transition-all">
                                Annulla
                            </button>
                            <button
                                onClick={handleExtract}
                                disabled={!text.trim() && files.length === 0}
                                className="btn-primary text-sm disabled:opacity-50 flex items-center gap-2"
                            >
                                <span className="material-symbols-outlined notranslate text-[16px]">auto_awesome</span>
                                Estrai dati
                            </button>
                        </>
                    )}
                    {step === 'preview' && (
                        <>
                            <button onClick={() => setStep('intake')} className="px-5 py-2.5 rounded-lg border border-border text-sm text-text-muted hover:text-text-primary transition-all">
                                Indietro
                            </button>
                            <button onClick={handleCommit} className="btn-primary text-sm flex items-center gap-2">
                                <span className="material-symbols-outlined notranslate text-[16px]">save</span>
                                Salva proprietà
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
