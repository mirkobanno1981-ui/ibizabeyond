import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface IcalEvent {
  dtstart: Date
  dtend: Date
  summary?: string
}

function parseIcal(data: string): IcalEvent[] {
  const unfolded = data.replace(/\r?\n[ \t]/g, '')
  const lines = unfolded.split(/\r?\n/)
  const events: IcalEvent[] = []
  let current: Partial<IcalEvent> & { duration?: string } | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const upper = line.toUpperCase()

    if (upper.startsWith('BEGIN:VEVENT')) {
      current = {}
    } else if (upper.startsWith('END:VEVENT')) {
      if (current && current.dtstart) {
        if (!current.dtend) {
          const end = new Date(current.dtstart)
          end.setDate(end.getDate() + 1)
          current.dtend = end
        }
        events.push(current as IcalEvent)
      }
      current = null
    } else if (current) {
      const colon = line.indexOf(':')
      if (colon === -1) continue
      const key = line.substring(0, colon).toUpperCase()
      const val = line.substring(colon + 1)

      if (key.includes('DTSTART')) current.dtstart = parseIcalDate(val)!
      else if (key.includes('DTEND')) current.dtend = parseIcalDate(val)!
      else if (key.includes('SUMMARY')) current.summary = val
    }
  }
  return events
}

function parseIcalDate(v: string): Date | null {
  if (!v) return null
  const clean = v.replace(/[-:]/g, '')
  if (clean.length >= 8) {
    const y = parseInt(clean.substring(0, 4))
    const m = parseInt(clean.substring(4, 6)) - 1
    const d = parseInt(clean.substring(6, 8))
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null
    return new Date(Date.UTC(y, m, d))
  }
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

async function fetchIcalDirect(url: string, timeoutMs = 10000): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    const text = await res.text()
    return text.includes('BEGIN:VCALENDAR') ? text : null
  } catch (_e) {
    return null
  } finally {
    clearTimeout(timer)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Optional: sync a single villa via ?v_uuid=...
  const url = new URL(req.url)
  const singleUuid = url.searchParams.get('v_uuid')

  let query = supabase
    .from('properties')
    .select('v_uuid, ical_url')
    .not('ical_url', 'is', null)
    .neq('ical_url', '')

  if (singleUuid) query = query.eq('v_uuid', singleUuid)

  const { data: villas, error: vErr } = await query
  if (vErr) {
    return new Response(JSON.stringify({ error: vErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  const results: Array<{ v_uuid: string; ok: boolean; events: number; error?: string }> = []
  const concurrency = 8
  let idx = 0

  async function worker() {
    while (idx < (villas?.length || 0)) {
      const i = idx++
      const villa = villas![i]
      try {
        const text = await fetchIcalDirect(villa.ical_url)
        if (!text) {
          await supabase.from('villa_ical_sync_status').upsert({
            v_uuid: villa.v_uuid,
            last_synced: new Date().toISOString(),
            last_error: 'fetch_failed',
            events_count: 0,
          })
          results.push({ v_uuid: villa.v_uuid, ok: false, events: 0, error: 'fetch_failed' })
          continue
        }

        const events = parseIcal(text)
        const rows = events
          .filter((e) => e.dtstart && e.dtend)
          .map((e) => {
            const end = new Date(e.dtend)
            end.setDate(end.getDate() - 1) // iCal DTEND is exclusive; store inclusive
            return {
              v_uuid: villa.v_uuid,
              start_date: toDateStr(e.dtstart),
              end_date: toDateStr(end < e.dtstart ? e.dtstart : end),
              summary: (e.summary || '').slice(0, 200),
            }
          })

        // Replace: delete existing rows for this villa, then insert fresh ones
        const { error: delErr } = await supabase
          .from('villa_blocked_dates')
          .delete()
          .eq('v_uuid', villa.v_uuid)
        if (delErr) throw delErr

        if (rows.length > 0) {
          const { error: insErr } = await supabase.from('villa_blocked_dates').insert(rows)
          if (insErr) throw insErr
        }

        await supabase.from('villa_ical_sync_status').upsert({
          v_uuid: villa.v_uuid,
          last_synced: new Date().toISOString(),
          last_error: null,
          events_count: rows.length,
        })

        results.push({ v_uuid: villa.v_uuid, ok: true, events: rows.length })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await supabase.from('villa_ical_sync_status').upsert({
          v_uuid: villa.v_uuid,
          last_synced: new Date().toISOString(),
          last_error: msg.slice(0, 500),
          events_count: 0,
        })
        results.push({ v_uuid: villa.v_uuid, ok: false, events: 0, error: msg })
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    total_events: results.reduce((sum, r) => sum + r.events, 0),
  }

  return new Response(JSON.stringify({ summary, results }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
})
