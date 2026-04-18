/**
 * Basic iCal parser and availability checker
 */

export async function fetchICal(url) {
    try {
        // Use a CORS proxy for client-side fetching from external domains
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error('Failed to fetch calendar');
        return await response.text();
    } catch (err) {
        console.error('Error fetching iCal:', err);
        return null;
    }
}

export function parseICal(data) {
    if (!data) return [];
    const events = [];
    const lines = data.split(/\r?\n/);
    let currentEvent = null;

    for (let line of lines) {
        if (line.startsWith('BEGIN:VEVENT')) {
            currentEvent = {};
        } else if (line.startsWith('END:VEVENT')) {
            if (currentEvent && currentEvent.dtstart && currentEvent.dtend) {
                events.push(currentEvent);
            }
            currentEvent = null;
        } else if (currentEvent) {
            const [key, ...values] = line.split(':');
            const val = values.join(':');
            if (key.startsWith('DTSTART')) {
                currentEvent.dtstart = parseDate(val);
            } else if (key.startsWith('DTEND')) {
                currentEvent.dtend = parseDate(val);
            } else if (key.startsWith('SUMMARY')) {
                currentEvent.summary = val;
            }
        }
    }
    return events;
}

function parseDate(icalDate) {
    if (!icalDate) return null;
    // Format: YYYYMMDDTHHMMSSZ or YYYYMMDD or with TZID
    // Strip anything before colon if present (like TZID=Europe/Madrid:)
    const cleanDate = icalDate.includes(':') ? icalDate.split(':').pop() : icalDate;
    
    const y = parseInt(cleanDate.substring(0, 4));
    const m = parseInt(cleanDate.substring(4, 6)) - 1;
    const d = parseInt(cleanDate.substring(6, 8));
    
    // We create a local date at midnight to avoid shifting issues when we only care about the day
    return new Date(y, m, d);
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
    }
    return Array.from(new Set(blocked)); // Unique dates
}
