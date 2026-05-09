import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function fmtDate(d: string): string {
  return d.replace(/-/g, '')
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

serve(async (req) => {
  const url = new URL(req.url)
  const agentId = url.searchParams.get('agent_id')
  const villaId = url.searchParams.get('villa_id')

  if (!agentId && !villaId) {
    return new Response('Missing agent_id or villa_id', { status: 400 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const ical: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ibiza Beyond//NONSGML v1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:Ibiza Beyond ${villaId ? 'Villa' : 'Bookings'}`,
  ]

  const stamp = nowStamp()

  if (villaId) {
    // Per-villa feed: booked quotes for this villa + villa_blocked_dates rows
    const { data: bookings } = await supabase
      .from('quotes')
      .select('id, check_in, check_out, status, clients(full_name), properties(villa_name)')
      .eq('v_uuid', villaId)
      .eq('status', 'booked')

    bookings?.forEach((b: any) => {
      ical.push('BEGIN:VEVENT')
      ical.push(`UID:quote-${b.id}@ibizabeyond.it`)
      ical.push(`DTSTAMP:${stamp}`)
      ical.push(`DTSTART;VALUE=DATE:${fmtDate(b.check_in)}`)
      ical.push(`DTEND;VALUE=DATE:${fmtDate(b.check_out)}`)
      ical.push(`SUMMARY:BOOKED - ${b.clients?.full_name || 'Guest'}`)
      ical.push(`DESCRIPTION:Villa: ${b.properties?.villa_name || ''}\\nGuest: ${b.clients?.full_name || ''}`)
      ical.push('END:VEVENT')
    })

    const { data: blocked } = await supabase
      .from('villa_blocked_dates')
      .select('id, start_date, end_date, summary')
      .eq('v_uuid', villaId)

    blocked?.forEach((b: any) => {
      ical.push('BEGIN:VEVENT')
      ical.push(`UID:block-${b.id}@ibizabeyond.it`)
      ical.push(`DTSTAMP:${stamp}`)
      ical.push(`DTSTART;VALUE=DATE:${fmtDate(b.start_date)}`)
      ical.push(`DTEND;VALUE=DATE:${fmtDate(b.end_date)}`)
      ical.push(`SUMMARY:${b.summary || 'Blocked'}`)
      ical.push('END:VEVENT')
    })
  } else if (agentId) {
    // Per-agent feed: existing behavior
    const { data: bookings, error } = await supabase
      .from('quotes')
      .select('*, properties(villa_name), clients(full_name)')
      .eq('agent_id', agentId)
      .eq('status', 'booked')

    if (error) {
      return new Response('Error fetching bookings', { status: 500 })
    }

    bookings?.forEach((b: any) => {
      ical.push('BEGIN:VEVENT')
      ical.push(`UID:${b.id}@ibizabeyond.it`)
      ical.push(`DTSTAMP:${stamp}`)
      ical.push(`DTSTART;VALUE=DATE:${fmtDate(b.check_in)}`)
      ical.push(`DTEND;VALUE=DATE:${fmtDate(b.check_out)}`)
      ical.push(`SUMMARY:BOOKING: ${b.properties?.villa_name} - ${b.clients?.full_name}`)
      ical.push(`DESCRIPTION:Guest: ${b.clients?.full_name}\\nVilla: ${b.properties?.villa_name}\\nStatus: ${b.status}\\nTotal: €${b.final_price}`)
      ical.push('END:VEVENT')
    })
  }

  ical.push('END:VCALENDAR')

  return new Response(ical.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${villaId ? 'villa' : 'bookings'}.ics"`,
      ...corsHeaders,
    },
  })
})
