import React, { useEffect, useRef, useState } from 'react';

const IBIZA_CENTER = [38.9067, 1.4206];

function parseGps(value) {
    if (!value) return null;
    const parts = String(value).split(',').map(n => parseFloat(n.trim()));
    if (parts.length !== 2 || parts.some(n => Number.isNaN(n))) return null;
    return parts;
}

function formatGps(lat, lng) {
    return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

export default function GpsMapPicker({ value, onChange, defaultCenter = IBIZA_CENTER, height = 280 }) {
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const markerRef = useRef(null);
    const onChangeRef = useRef(onChange);
    const [textValue, setTextValue] = useState(value || '');

    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

    useEffect(() => {
        setTextValue(value || '');
        const parsed = parseGps(value);
        if (parsed && mapRef.current && markerRef.current) {
            markerRef.current.setLatLng(parsed);
            mapRef.current.setView(parsed, Math.max(mapRef.current.getZoom(), 13));
        }
    }, [value]);

    useEffect(() => {
        if (!containerRef.current) return;

        const loadLeaflet = () => {
            if (window.L) {
                initMap();
                return;
            }

            if (!document.querySelector('link[data-leaflet-css]')) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
                link.setAttribute('data-leaflet-css', '1');
                document.head.appendChild(link);
            }

            const existing = document.querySelector('script[data-leaflet-js]');
            if (existing) {
                existing.addEventListener('load', initMap, { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.setAttribute('data-leaflet-js', '1');
            script.onload = initMap;
            document.head.appendChild(script);
        };

        const initMap = () => {
            if (!window.L || !containerRef.current || mapRef.current) return;

            const parsed = parseGps(value);
            const center = parsed || defaultCenter;
            const map = window.L.map(containerRef.current, {
                center,
                zoom: parsed ? 14 : 11,
                zoomControl: true,
            });
            mapRef.current = map;

            window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '© OpenStreetMap · © CARTO',
                subdomains: 'abcd',
                maxZoom: 19,
            }).addTo(map);

            const icon = window.L.divIcon({
                className: 'gps-pin-icon',
                html: '<div style="width:22px;height:22px;background:#D4AF37;border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 4px 10px rgba(0,0,0,0.4)"></div>',
                iconSize: [22, 22],
                iconAnchor: [11, 22],
            });

            const marker = window.L.marker(parsed || defaultCenter, {
                draggable: true,
                icon,
                opacity: parsed ? 1 : 0.35,
            }).addTo(map);
            markerRef.current = marker;

            marker.on('dragend', () => {
                const { lat, lng } = marker.getLatLng();
                marker.setOpacity(1);
                const v = formatGps(lat, lng);
                setTextValue(v);
                onChangeRef.current?.(v);
            });

            map.on('click', (e) => {
                const { lat, lng } = e.latlng;
                marker.setLatLng([lat, lng]);
                marker.setOpacity(1);
                const v = formatGps(lat, lng);
                setTextValue(v);
                onChangeRef.current?.(v);
            });

            setTimeout(() => map.invalidateSize(), 100);
        };

        loadLeaflet();

        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
                markerRef.current = null;
            }
        };
    }, []);

    const handleTextChange = (e) => {
        const v = e.target.value;
        setTextValue(v);
        const parsed = parseGps(v);
        if (parsed) {
            onChangeRef.current?.(formatGps(parsed[0], parsed[1]));
        } else if (v === '') {
            onChangeRef.current?.('');
        }
    };

    const parsed = parseGps(textValue);

    return (
        <div className="space-y-2">
            <div
                ref={containerRef}
                className="w-full rounded-lg overflow-hidden border border-border bg-surface-2"
                style={{ height: `${height}px` }}
            />
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    className="input-theme flex-1 font-mono text-xs"
                    value={textValue}
                    onChange={handleTextChange}
                    placeholder="38.906700,1.420600"
                />
                <span className={`text-[10px] uppercase tracking-widest font-black px-2 py-1 rounded ${parsed ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                    {parsed ? 'Valid' : 'Click map'}
                </span>
            </div>
            <p className="text-[10px] text-text-muted italic">
                Click on the map or drag the pin to set the coordinates. Paste "lat,lng" from Google Maps works too.
            </p>
        </div>
    );
}
