import React, { useEffect, useRef } from 'react';

export default function VillaMap({ locations, zoom = 14, center, radius = 1000, height = "100%" }) {
    const mapContainerRef = useRef(null);
    const mapInstanceRef = useRef(null);

    useEffect(() => {
        if (!locations || locations.length === 0 || !mapContainerRef.current) return;

        const loadLeaflet = () => {
            if (window.L) {
                initMap();
                return;
            }

            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);

            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.onload = initMap;
            document.head.appendChild(script);

            const style = document.createElement('style');
            style.innerHTML = `
                .luxury-popup .leaflet-popup-content-wrapper {
                    background: white;
                    color: #1e293b;
                    padding: 0;
                    overflow: hidden;
                    border-radius: 20px;
                    box-shadow: 0 15px 35px -5px rgba(0, 0, 0, 0.4);
                    border: 1px solid rgba(212, 175, 55, 0.2);
                }
                .luxury-popup .leaflet-popup-content {
                    margin: 0;
                    width: 240px !important;
                }
                .luxury-popup .leaflet-popup-tip {
                    background: white;
                }
                .gold-marker {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #D4AF37;
                    border: 3px solid white;
                    border-radius: 50% 50% 50% 0;
                    transform: rotate(-45deg);
                    box-shadow: 0 4px 10px rgba(0,0,0,0.3);
                }
            `;
            document.head.appendChild(style);
        };

        const initMap = () => {
            if (!window.L || !mapContainerRef.current) return;

            if (mapInstanceRef.current) {
                mapInstanceRef.current.remove();
            }

            // Process locations
            const points = locations.map(loc => {
                if (!loc.gps) return null;
                const [lat, lng] = loc.gps.split(',').map(n => parseFloat(n.trim()));
                return { lat, lng, name: loc.name, id: loc.id, image: loc.image };
            }).filter(Boolean);

            if (points.length === 0) return;

            // Determine center
            let mapCenter = center;
            if (!mapCenter) {
                if (points.length === 1) {
                    mapCenter = [points[0].lat, points[0].lng];
                } else {
                    const avgLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
                    const avgLng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
                    mapCenter = [avgLat, avgLng];
                }
            }

            const map = window.L.map(mapContainerRef.current, {
                center: mapCenter,
                zoom: zoom,
                zoomControl: true,
                scrollWheelZoom: false,
                attributionControl: false
            });

            mapInstanceRef.current = map;

            // Voyager tile layer
            window.L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
                maxZoom: 20,
                subdomains: 'abcd'
            }).addTo(map);

            points.forEach(p => {
                const isPrecise = radius === 0;

                // Villa preview popup — shared by both modes
                const popupContent = `
                    <div style="cursor:${p.id ? 'pointer' : 'default'}; width: 240px;" ${p.id ? `onclick="window.location.href='/villas/${p.id}'"` : ''}>
                        ${p.image
                            ? `<div style="width:100%;height:140px;overflow:hidden;"><img src="${p.image}" style="width:100%;height:100%;object-fit:cover;display:block;" /></div>`
                            : `<div style="width:100%;height:80px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;">
                                <span class="material-symbols-outlined notranslate" style="font-size:36px;color:#cbd5e1;">home</span>
                               </div>`
                        }
                        <div style="padding:14px 16px 16px;">
                            <b style="color:#1e293b;font-size:15px;display:block;margin-bottom:4px;line-height:1.3;font-family:sans-serif;">${p.name || 'Villa'}</b>
                            ${!isPrecise
                                ? `<p style="color:#94a3b8;font-size:11px;margin:0 0 10px;font-family:sans-serif;line-height:1.4;">Indicative area — exact location provided after booking</p>`
                                : ''
                            }
                            ${p.id
                                ? `<div style="color:#D4AF37;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;display:flex;align-items:center;gap:4px;font-family:sans-serif;">
                                    View Property
                                    <span class="material-symbols-outlined notranslate" style="font-size:14px;">arrow_forward</span>
                                   </div>`
                                : ''
                            }
                        </div>
                    </div>
                `;

                if (isPrecise) {
                    // Gold pin marker for exact location
                    const icon = window.L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div class="gold-marker" style="width:32px;height:32px;">
                                 <span class="material-symbols-outlined notranslate" style="transform:rotate(45deg);color:white;font-size:18px;">home</span>
                               </div>`,
                        iconSize: [32, 32],
                        iconAnchor: [16, 32]
                    });

                    const marker = window.L.marker([p.lat, p.lng], { icon }).addTo(map);
                    marker.bindPopup(popupContent, {
                        className: 'luxury-popup',
                        closeButton: false,
                        offset: [0, -25]
                    });
                } else {
                    // Indicative mode: only the dashed circle — NO central dot
                    const circle = window.L.circle([p.lat, p.lng], {
                        color: '#D4AF37',
                        fillColor: '#D4AF37',
                        fillOpacity: 0.12,
                        weight: 2,
                        dashArray: '6, 10',
                        radius: radius
                    }).addTo(map);

                    circle.bindPopup(popupContent, {
                        className: 'luxury-popup',
                        closeButton: false
                    });
                }
            });

            // Fit bounds when multiple points
            if (points.length > 1 && !center) {
                const bounds = window.L.latLngBounds(points.map(p => [p.lat, p.lng]));
                map.fitBounds(bounds, { padding: [70, 70] });
            }
        };

        loadLeaflet();

        return () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
            }
        };
    }, [locations, zoom, center, radius]);

    return (
        <div ref={mapContainerRef} style={{ height }} className="w-full bg-surface" />
    );
}
