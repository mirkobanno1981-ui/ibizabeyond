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
    // Format: YYYYMMDDTHHMMSSZ or YYYYMMDD
    const y = icalDate.substring(0, 4);
    const m = icalDate.substring(4, 6);
    const d = icalDate.substring(6, 8);
    return new Date(`${y}-${m}-${d}`);
}

export function isAvailable(events, checkIn, checkOut) {
    if (!events || events.length === 0) return true;
    const start = new Date(checkIn);
    const end = new Date(checkOut);

    for (const event of events) {
        // Event dates are inclusive-exclusive (usually)
        // Overlap check: (StartA < EndB) && (EndA > StartB)
        if (event.dtstart < end && event.dtend > start) {
            return false;
        }
    }
    return true;
}

export function getBlockedDates(events) {
    const blocked = [];
    for (const event of events) {
        let curr = new Date(event.dtstart);
        while (curr < event.dtend) {
            blocked.push(new Date(curr).toISOString().split('T')[0]);
            curr.setDate(curr.getDate() + 1);
        }
    }
    return blocked;
}
