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

  // Optional filters: ?v_uuid=... and ?kind=villa|boat|all (default all)
  const url = new URL(req.url)
  const singleUuid = url.searchParams.get('v_uuid')
  const kind = (url.searchParams.get('kind') || 'all').toLowerCase()

  async function loadAssets(
    table: 'properties' | 'boats',
  ): Promise<Array<{ v_uuid: string; ical_url: string }>> {
    let q = supabase
      .from(table)
      .select('v_uuid, ical_url')
      .not('ical_url', 'is', null)
      .neq('ical_url', '')
    if (singleUuid) q = q.eq('v_uuid', singleUuid)
    const { data, error } = await q
    if (error) throw error
    return (data || []) as Array<{ v_uuid: string; ical_url: string }>
  }

  let villas: Array<{ v_uuid: string; ical_url: string }> = []
  let boats: Array<{ v_uuid: string; ical_url: string }> = []
  try {
    if (kind === 'villa' || kind === 'all') villas = await loadAssets('properties')
    if (kind === 'boat' || kind === 'all') boats = await loadAssets('boats')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  type AssetKind = 'villa' | 'boat'
  type Job = { kind: AssetKind; v_uuid: string; ical_url: string }
  const jobs: Job[] = [
    ...villas.map((v) => ({ kind: 'villa' as const, v_uuid: v.v_uuid, ical_url: v.ical_url })),
    ...boats.map((b) => ({ kind: 'boat' as const, v_uuid: b.v_uuid, ical_url: b.ical_url })),
  ]

  function tablesFor(k: AssetKind): { blocked: string; status: string } {
    return k === 'villa'
      ? { blocked: 'villa_blocked_dates', status: 'villa_ical_sync_status' }
      : { blocked: 'boat_blocked_dates', status: 'boat_ical_sync_status' }
  }

  const results: Array<{ kind: AssetKind; v_uuid: string; ok: boolean; events: number; error?: string }> = []
  const concurrency = 8
  let idx = 0

  async function worker() {
    while (idx < jobs.length) {
      const i = idx++
      const job = jobs[i]
      const { blocked, status } = tablesFor(job.kind)
      try {
        const text = await fetchIcalDirect(job.ical_url)
        if (!text) {
          await supabase.from(status).upsert({
            v_uuid: job.v_uuid,
            last_synced: new Date().toISOString(),
            last_error: 'fetch_failed',
            events_count: 0,
          })
          results.push({ kind: job.kind, v_uuid: job.v_uuid, ok: false, events: 0, error: 'fetch_failed' })
          continue
        }

        const events = parseIcal(text)
        const rows = events
          .filter((e) => e.dtstart && e.dtend)
          .map((e) => {
            const end = new Date(e.dtend)
            end.setDate(end.getDate() - 1) // iCal DTEND is exclusive; store inclusive
            return {
              v_uuid: job.v_uuid,
              start_date: toDateStr(e.dtstart),
              end_date: toDateStr(end < e.dtstart ? e.dtstart : end),
              summary: (e.summary || '').slice(0, 200),
            }
          })

        const { error: delErr } = await supabase
          .from(blocked)
          .delete()
          .eq('v_uuid', job.v_uuid)
        if (delErr) throw delErr

        if (rows.length > 0) {
          const { error: insErr } = await supabase.from(blocked).insert(rows)
          if (insErr) throw insErr
        }

        await supabase.from(status).upsert({
          v_uuid: job.v_uuid,
          last_synced: new Date().toISOString(),
          last_error: null,
          events_count: rows.length,
        })

        results.push({ kind: job.kind, v_uuid: job.v_uuid, ok: true, events: rows.length })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await supabase.from(status).upsert({
          v_uuid: job.v_uuid,
          last_synced: new Date().toISOString(),
          last_error: msg.slice(0, 500),
          events_count: 0,
        })
        results.push({ kind: job.kind, v_uuid: job.v_uuid, ok: false, events: 0, error: msg })
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  const summary = {
    total: results.length,
    villas: results.filter((r) => r.kind === 'villa').length,
    boats: results.filter((r) => r.kind === 'boat').length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    total_events: results.reduce((sum, r) => sum + r.events, 0),
  }

  return new Response(JSON.stringify({ summary, results }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
})
