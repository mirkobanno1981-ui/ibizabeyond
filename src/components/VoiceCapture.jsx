import React, { useEffect, useRef, useState } from 'react';

// Records audio via MediaRecorder. No live transcription — emits a File on stop.
// Props:
//   onRecorded(file) — called with the recorded audio File once user confirms.
//   maxSeconds       — auto-stop after this many seconds (default 120).
//   disabled         — disable record button.
export default function VoiceCapture({ onRecorded, maxSeconds = 120, disabled = false }) {
    const [status, setStatus] = useState('idle'); // idle | recording | preview | error
    const [error, setError] = useState(null);
    const [elapsed, setElapsed] = useState(0);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [audioFile, setAudioFile] = useState(null);

    const mediaRecorderRef = useRef(null);
    const chunksRef = useRef([]);
    const streamRef = useRef(null);
    const timerRef = useRef(null);

    useEffect(() => () => cleanup(), []); // eslint-disable-line

    function cleanup() {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    }

    function pickMimeType() {
        const candidates = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
            'audio/ogg;codecs=opus',
        ];
        for (const m of candidates) {
            if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) {
                return m;
            }
        }
        return '';
    }

    async function startRecording() {
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const mime = pickMimeType();
            const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
            chunksRef.current = [];
            rec.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
            rec.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
                const ext = (rec.mimeType || 'audio/webm').includes('mp4') ? 'm4a' : 'webm';
                const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: blob.type });
                setAudioFile(file);
                setPreviewUrl(URL.createObjectURL(blob));
                setStatus('preview');
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach(t => t.stop());
                    streamRef.current = null;
                }
            };
            mediaRecorderRef.current = rec;
            rec.start();
            setStatus('recording');
            setElapsed(0);
            timerRef.current = setInterval(() => {
                setElapsed(prev => {
                    const next = prev + 1;
                    if (next >= maxSeconds) {
                        stopRecording();
                    }
                    return next;
                });
            }, 1000);
        } catch (err) {
            console.error('Mic error', err);
            setError(err?.message || 'Microphone access denied');
            setStatus('error');
        }
    }

    function stopRecording() {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        const rec = mediaRecorderRef.current;
        if (rec && rec.state !== 'inactive') rec.stop();
    }

    function discard() {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setAudioFile(null);
        setStatus('idle');
        setElapsed(0);
    }

    function confirm() {
        if (audioFile) {
            onRecorded?.(audioFile);
        }
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setAudioFile(null);
        setStatus('idle');
        setElapsed(0);
    }

    const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

    return (
        <div className="flex items-center gap-2 flex-wrap">
            {status === 'idle' && (
                <button
                    type="button"
                    onClick={startRecording}
                    disabled={disabled}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-border text-text-primary text-xs font-medium hover:border-primary/40 hover:text-primary disabled:opacity-50 transition-colors"
                >
                    <span className="material-symbols-outlined notranslate text-[16px]">mic</span>
                    Record audio
                </button>
            )}

            {status === 'recording' && (
                <>
                    <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/40 text-red-400 text-xs font-medium">
                        <span className="size-2 rounded-full bg-red-500 animate-pulse" />
                        Recording · {fmt(elapsed)} / {fmt(maxSeconds)}
                    </div>
                    <button
                        type="button"
                        onClick={stopRecording}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-background-dark text-xs font-bold hover:scale-[1.02] transition-transform"
                    >
                        <span className="material-symbols-outlined notranslate text-[16px]">stop</span>
                        Stop
                    </button>
                </>
            )}

            {status === 'preview' && (
                <>
                    <audio src={previewUrl} controls className="h-8" />
                    <button
                        type="button"
                        onClick={confirm}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-background-dark text-xs font-bold"
                    >
                        <span className="material-symbols-outlined notranslate text-[14px]">check</span>
                        Use
                    </button>
                    <button
                        type="button"
                        onClick={discard}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-2 border border-border text-text-muted text-xs font-medium hover:text-red-400"
                    >
                        <span className="material-symbols-outlined notranslate text-[14px]">delete</span>
                        Discard
                    </button>
                </>
            )}

            {status === 'error' && (
                <div className="text-[11px] text-red-400">
                    {error}
                    <button onClick={() => { setStatus('idle'); setError(null); }} className="ml-2 underline">Retry</button>
                </div>
            )}
        </div>
    );
}
