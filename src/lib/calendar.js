/**
 * Basic iCal parser and availability checker
 */

const icalCache = new Map();

export async function fetchICal(url) {
    if (!url) return null;
    
    // Check cache (TTL 5 mins)
    const cached = icalCache.get(url);
    if (cached && (Date.now() - cached.timestamp < 5 * 60 * 1000)) {
        return cached.data;
    }

    const proxies = [
        u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
        u => `https://thingproxy.freeboard.io/fetch/${u}`
    ];

    for (const getProxy of proxies) {
        try {
            const response = await fetch(getProxy(url));
            if (response.ok) {
                const text = await response.text();
                // Basic validation: iCal files start with BEGIN:VCALENDAR
                if (text && text.includes('BEGIN:VCALENDAR')) {
                    icalCache.set(url, { data: text, timestamp: Date.now() });
                    return text;
                }
            }
        } catch (err) {
            console.warn(`Proxy failed for ${url}:`, err.message);
        }
    }
    console.error('All iCal proxies failed for:', url);
    return null;
}

export function parseICal(data) {
    if (!data) return [];
    
    // 1. Unfold lines (Join lines starting with space/tab to the previous line)
    const unfolded = data.replace(/\r?\n[ \t]/g, '');
    const lines = unfolded.split(/\r?\n/);
    const events = [];
    let currentEvent = null;

    for (let line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const upperLine = trimmed.toUpperCase();

        if (upperLine.startsWith('BEGIN:VEVENT')) {
            currentEvent = {};
        } else if (upperLine.startsWith('END:VEVENT')) {
            if (currentEvent && currentEvent.dtstart) {
                // If DTEND is missing, use DTSTART + DURATION or just DTSTART (1 day)
                if (!currentEvent.dtend) {
                    if (currentEvent.duration) {
                        currentEvent.dtend = addDuration(currentEvent.dtstart, currentEvent.duration);
                    } else {
                        // Single day event: ends the next day at midnight
                        const end = new Date(currentEvent.dtstart);
                        end.setDate(end.getDate() + 1);
                        currentEvent.dtend = end;
                    }
                }
                events.push(currentEvent);
            }
            currentEvent = null;
        } else if (currentEvent) {
            const colonIdx = trimmed.indexOf(':');
            if (colonIdx === -1) continue;
            
            const keyPart = trimmed.substring(0, colonIdx).toUpperCase();
            const val = trimmed.substring(colonIdx + 1);

            if (keyPart.includes('DTSTART')) {
                currentEvent.dtstart = parseDate(val);
            } else if (keyPart.includes('DTEND')) {
                currentEvent.dtend = parseDate(val);
            } else if (keyPart.includes('DURATION')) {
                currentEvent.duration = val;
            } else if (keyPart.includes('SUMMARY')) {
                currentEvent.summary = val;
            }
        }
    }
    return events;
}

function addDuration(start, duration) {
    // Basic iCal duration parser (e.g., P1D, PT10H, P1W)
    const match = duration.match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/);
    if (!match) return start;
    
    const weeks = parseInt(match[1] || 0);
    const days = parseInt(match[2] || 0);
    const hours = parseInt(match[3] || 0);
    const minutes = parseInt(match[4] || 0);
    const seconds = parseInt(match[5] || 0);
    
    const end = new Date(start);
    end.setDate(end.getDate() + (weeks * 7) + days);
    end.setHours(end.getHours() + hours, end.getMinutes() + minutes, end.getSeconds() + seconds);
    return end;
}

function parseDate(icalDate) {
    if (!icalDate) return null;
    
    // Strip trailing Z or extra time info if we only need the date
    // format could be 20240502T230000Z or 2024-05-02
    const clean = icalDate.replace(/[-:]/g, ''); // Remove all dashes and colons for uniform parsing
    
    if (clean.length >= 8) {
        const y = parseInt(clean.substring(0, 4));
        const m = parseInt(clean.substring(4, 6)) - 1;
        const d = parseInt(clean.substring(6, 8));
        
        if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
        return new Date(y, m, d);
    }
    
    // Fallback for other formats
    const d = new Date(icalDate);
    return isNaN(d.getTime()) ? null : d;
}

export function isAvailable(events, checkIn, checkOut) {
    if (!events || events.length === 0) return true;
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    // Ensure hours are zeroed for comparison
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    for (const event of events) {
        const eventStart = new Date(event.dtstart);
        const eventEnd = new Date(event.dtend);
        eventStart.setHours(0,0,0,0);
        eventEnd.setHours(0,0,0,0);

        // Standard overlap: (StartA < EndB) && (EndA > StartB)
        if (eventStart < end && eventEnd > start) {
            return false;
        }
    }
    return true;
}

export function getBlockedDates(events) {
    const blocked = [];
    for (const event of events) {
        let curr = new Date(event.dtstart);
        const end = new Date(event.dtend);
        
        // Zero out times to work with full days
        curr.setHours(0, 0, 0, 0);
        end.setHours(0, 0, 0, 0);

        while (curr < end) {
            const dStr = curr.getFullYear() + '-' + 
                        String(curr.getMonth() + 1).padStart(2, '0') + '-' + 
                        String(curr.getDate()).padStart(2, '0');
            blocked.push(dStr);
            curr.setDate(curr.getDate() + 1);
        }
        
        // Handle EXDATE (Exclusion dates) - if the parser added them special, but here we usually just add events.
        // If the event itself has exdates, we'd need to remove them from 'blocked'.
        // For now, most PMS exports don't use EXDATE for individual bookings.
    }
    return Array.from(new Set(blocked)); // Unique dates
}

export function clearICalCache(url) {
    if (url) icalCache.delete(url);
    else icalCache.clear();
}
