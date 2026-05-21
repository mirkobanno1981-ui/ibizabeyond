import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_MODEL = 'gemini-2.5-flash'

const PARSED_SCHEMA = {
  type: 'OBJECT',
  properties: {
    check_in:           { type: 'STRING', description: 'ISO YYYY-MM-DD or empty string if unknown' },
    check_out:          { type: 'STRING', description: 'ISO YYYY-MM-DD or empty string if unknown' },
    nights:             { type: 'INTEGER' },
    bedrooms_min:       { type: 'INTEGER' },
    guests_min:         { type: 'INTEGER' },
    budget_value_eur:   { type: 'NUMBER', description: 'raw value before period normalization (0 if not given)' },
    budget_period:      { type: 'STRING', enum: ['total', 'per_week', 'per_night', 'unknown'] },
    budget_total_eur:   { type: 'NUMBER', description: 'normalized to whole stay (0 if cannot compute)' },
    currency:           { type: 'STRING', description: 'ISO 4217, default EUR' },
    property_type:      { type: 'STRING', enum: ['villa', 'apartment', 'finca', 'any'] },
    amenities:          { type: 'ARRAY', items: { type: 'STRING' }, description: 'CANONICAL labels from catalog only' },
    amenities_freeform: { type: 'ARRAY', items: { type: 'STRING' }, description: 'extras not in catalog' },
    area_preference:    { type: 'STRING' },
    group_type:         { type: 'STRING', enum: ['family', 'friends', 'couple', 'corporate', 'other', 'unknown'] },
    has_pets:           { type: 'BOOLEAN' },
    notes:              { type: 'STRING' },
    confidence:         { type: 'NUMBER' },
  },
  required: ['confidence'],
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiKey) return jsonError('GEMINI_API_KEY not configured', 500)

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError('Missing Authorization header', 401)

    const supaUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await supaUser.auth.getUser()
    if (userErr || !userData?.user) return jsonError('Not authenticated', 401)

    const body = await req.json()
    const rawText: string = (body?.raw_text || '').toString().trim()
    if (!rawText) return jsonError('raw_text required', 400)

    const { data: amenities } = await supaUser
      .from('amenity_catalog')
      .select('label, category')
      .eq('is_active', true)
      .order('category')
    const amenityList = (amenities || []).map((a: any) => `${a.category}: ${a.label}`).join('\n')

    const today = new Date().toISOString().slice(0, 10)
    const systemPrompt = buildPrompt(today, amenityList)

    const parts: any[] = [
      { text: systemPrompt },
      { text: `\n--- REQUEST TEXT ---\n${rawText}` },
    ]

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`
    let parsed: any = null
    let lastError: string | null = null

    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema: PARSED_SCHEMA,
          },
        }),
      })
      if (!res.ok) { lastError = `Gemini ${res.status}: ${await res.text()}`; continue }
      const json = await res.json()
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) { lastError = 'Empty Gemini response'; continue }
      try { parsed = JSON.parse(text); break } catch (e) { lastError = `Invalid JSON: ${(e as Error).message}` }
    }

    if (!parsed) return jsonError(lastError || 'AI parse failed', 500)

    const canonicalLabels = new Set((amenities || []).map((a: any) => String(a.label)))
    const lowerToCanonical = new Map<string, string>()
    for (const label of canonicalLabels) lowerToCanonical.set(label.toLowerCase(), label)

    const cleanAmenities: string[] = []
    const freeform: string[] = Array.isArray(parsed.amenities_freeform) ? [...parsed.amenities_freeform] : []
    if (Array.isArray(parsed.amenities)) {
      for (const a of parsed.amenities) {
        const key = String(a).toLowerCase().trim()
        const canonical = lowerToCanonical.get(key)
        if (canonical) cleanAmenities.push(canonical)
        else if (a) freeform.push(String(a))
      }
    }

    const nights = computeNights(parsed.check_in, parsed.check_out, parsed.nights)
    const budgetTotal = computeBudgetTotal(parsed.budget_value_eur, parsed.budget_period, nights, parsed.budget_total_eur)

    const result = {
      check_in: parsed.check_in || null,
      check_out: parsed.check_out || null,
      nights: nights || null,
      bedrooms_min: parsed.bedrooms_min || null,
      guests_min: parsed.guests_min || null,
      budget_value_eur: parsed.budget_value_eur || null,
      budget_period: parsed.budget_period && parsed.budget_period !== 'unknown' ? parsed.budget_period : null,
      budget_total_eur: budgetTotal || null,
      currency: parsed.currency || 'EUR',
      property_type: parsed.property_type || 'any',
      amenities: [...new Set(cleanAmenities)],
      amenities_freeform: [...new Set(freeform)],
      area_preference: parsed.area_preference || null,
      group_type: parsed.group_type && parsed.group_type !== 'unknown' ? parsed.group_type : null,
      has_pets: typeof parsed.has_pets === 'boolean' ? parsed.has_pets : null,
      notes: parsed.notes || null,
    }
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5

    return new Response(JSON.stringify({ parsed: result, confidence }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('client-request-parse error:', err)
    return jsonError((err as Error)?.message || String(err), 500)
  }
})

function computeNights(checkIn: any, checkOut: any, given: any): number {
  if (typeof given === 'number' && given > 0) return Math.round(given)
  if (typeof checkIn === 'string' && typeof checkOut === 'string' && checkIn && checkOut) {
    const a = new Date(checkIn).getTime()
    const b = new Date(checkOut).getTime()
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      return Math.round((b - a) / 86_400_000)
    }
  }
  return 0
}

function computeBudgetTotal(value: any, period: any, nights: number, given: any): number {
  if (typeof given === 'number' && given > 0) return Math.round(given)
  const v = Number(value) || 0
  if (!v) return 0
  if (period === 'total') return Math.round(v)
  if (period === 'per_night') return Math.round(v * (nights || 7))
  if (period === 'per_week') {
    const wk = nights ? nights / 7 : 1
    return Math.round(v * wk)
  }
  return 0
}

function buildPrompt(today: string, amenityList: string): string {
  return `You parse free-text Ibiza villa rental requests written by B2B agents into structured JSON.
Today is ${today}. Output valid JSON conforming to the schema. Use English values, ISO dates.
Input may be Italian, English, or Spanish.

DATES
- "15/07 - 15/08" -> check_in 2026-07-15, check_out 2026-08-15. Use the NEXT future occurrence relative to today; if both months are past for the current year, roll to next year.
- "dal 1 agosto per 2 settimane" -> compute check_out = check_in + 14 days.
- "una settimana ad agosto" -> nights=7, check_in="" (empty), put "August" in notes.
- DD/MM and DD-MM are day-month; never month-day.

BUDGET
- "35 k settimana" -> budget_value_eur=35000, budget_period=per_week.
- "200k stagione" / "200k totale" -> total.
- "5k a notte" / "5k/night" -> per_night.
- "k", "K", "mila" all = 1000. Strip "€", "EUR".
- Compute budget_total_eur from value * (nights/7 if per_week, nights if per_night, 1 if total).
  Use nights=7 fallback when only per_week is given and no dates.
- If no budget mentioned: budget_value_eur=0, budget_period=unknown, budget_total_eur=0.

CAPACITY
- "5 bed" / "5 camere" / "5 stanze" -> bedrooms_min=5.
- "10 persone" / "sleeps 10" / "for 10" -> guests_min=10.
- Do NOT infer guests_min from bedrooms alone.

AMENITIES — use ONLY these canonical labels (case-sensitive, exact spelling). Common synonyms:
- "gym" / "palestra" -> Gym
- "piscina" / "pool" -> Pool. "infinity" / "a sfioro" -> Infinity Pool. "riscaldata" / "heated" -> Heated Pool.
- "vista mare" / "sea view" -> Sea View. "tramonto" -> Sunset View.
- "spa" alone is too vague; only add Sauna / Hammam / Massage Room if explicitly named.
- Anything not in this catalog goes to amenities_freeform.

CATALOG:
${amenityList}

AREA
- Keep verbatim Ibiza place names: San José / Sant Josep, Es Cubells, Cala Jondal, Roca Llisa, Cap Martinet, Talamanca, Es Cavallet, Santa Eulalia.
- Empty string if no area mentioned.

GROUP
- "famiglia" -> family. "amici" -> friends. "coppia" -> couple. "azienda" / "corporate" -> corporate.
- Empty / unknown otherwise.

CONFIDENCE
- 0.0 to 1.0. Lower it when dates are ambiguous, budget is missing, or amenities are vague.

Respond with VALID JSON only.`
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
