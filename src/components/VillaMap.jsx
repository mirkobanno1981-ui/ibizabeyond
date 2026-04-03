import React, { useEffect, useRef } from 'react';

export default function VillaMap({ locations, zoom = 12, center, radius = 2000, height = "100%" }) {
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

            // Add standard styles for popups
            const style = document.createElement('style');
            style.innerHTML = `
                .luxury-popup .leaflet-popup-content-wrapper {
                    background: white;
                    color: #1e293b;
                    padding: 0;
                    overflow: hidden;
                    border-radius: 16px;
                    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
                }
                .luxury-popup .leaflet-popup-content {
                    margin: 0;
                    width: 180px !important;
                }
                .luxury-popup .leaflet-popup-tip {
                    background: white;
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
                const [lat, lng] = loc.gps.split(',').map(n => parseFloat(n.trim()));
                return { lat, lng, name: loc.name, id: loc.id, image: loc.image };
            });

            if (points.length === 0) return;

            // Determine center
            let mapCenter = center;
            if (!mapCenter) {
                if (points.length === 1) {
                    mapCenter = [points[0].lat, points[0].lng];
                } else {
                    // Average center
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

            window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                maxZoom: 19
            }).addTo(map);

            points.forEach(p => {
                // Add the circle
                const circle = window.L.circle([p.lat, p.lng], {
                    color: '#D4AF37',
                    fillColor: '#D4AF37',
                    fillOpacity: 0.2,
                    weight: 1,
                    radius: radius // in meters,
                }).addTo(map);

                const popupContent = `
                    <div class="luxury-card" style="cursor: pointer; width: 180px;" onclick="window.location.href='/villas/${p.id}'">
                        ${p.image ? `<img src="${p.image}" style="width: 100%; height: 100px; object-fit: cover; display: block;" />` : ''}
                        <div style="padding: 12px;">
                            <b style="color: #1e293b; font-size: 14px; display: block; margin-bottom: 4px; line-height: 1.2;">${p.name}</b>
                            <div style="color: #D4AF37; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; display: flex; items-center; gap: 4px;">
                                View Details <span class="material-symbols-outlined notranslate" style="font-size: 12px; margin-left: 2px;">arrow_forward</span>
                            </div>
                        </div>
                    </div>
                `;

                circle.bindPopup(popupContent, {
                    className: 'luxury-popup',
                    closeButton: false,
                    offset: [0, -5]
                });

                // Open popup on click
                circle.on('click', function (e) {
                    this.openPopup();
                });
            });

            // Adjust view to fit all points if multiple
            if (points.length > 1 && !center) {
                 const bounds = window.L.latLngBounds(points.map(p => [p.lat, p.lng]));
                 map.fitBounds(bounds, { padding: [50, 50] });
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
