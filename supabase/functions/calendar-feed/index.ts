import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  const url = new URL(req.url);
  const agentId = url.searchParams.get('agent_id');

  if (!agentId) {
    return new Response('Missing agent_id', { status: 400 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch bookings
  const { data: bookings, error } = await supabase
    .from('quotes')
    .select('*, invenio_properties(villa_name), clients(full_name)')
    .eq('agent_id', agentId)
    .eq('status', 'booked');

  if (error) {
    return new Response('Error fetching bookings', { status: 500 });
  }

  // Generate iCal content
  let ical = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ibiza Beyond//NONSGML v1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Ibiza Beyond Bookings',
  ];

  bookings?.forEach(b => {
    const checkIn = new Date(b.check_in).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const checkOut = new Date(b.check_out).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const uid = `${b.id}@ibizabeyond.it`;
    
    ical.push('BEGIN:VEVENT');
    ical.push(`UID:${uid}`);
    ical.push(`DTSTAMP:${stamp}`);
    ical.push(`DTSTART;VALUE=DATE:${b.check_in.replace(/-/g, '')}`);
    ical.push(`DTEND;VALUE=DATE:${b.check_out.replace(/-/g, '')}`);
    ical.push(`SUMMARY:BOOKING: ${b.invenio_properties?.villa_name} - ${b.clients?.full_name}`);
    ical.push(`DESCRIPTION:Guest: ${b.clients?.full_name}\\nVilla: ${b.invenio_properties?.villa_name}\\nStatus: ${b.status}\\nTotal: €${b.final_price}`);
    ical.push('END:VEVENT');
  });

  ical.push('END:VCALENDAR');

  return new Response(ical.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="bookings.ics"',
      ...corsHeaders,
    },
  });
})
