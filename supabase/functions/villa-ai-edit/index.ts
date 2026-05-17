import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_MODEL = 'gemini-2.5-flash'
const MAX_AUDIO_BYTES = 15 * 1024 * 1024 // ~15 MB inline budget for audio

// Editable scalar fields the AI may patch. Keep aligned with VillaEditModal form.
// Photos, videos, seasonal rates, commission and ownership fields are NOT in scope.
const PATCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    villa_name: { type: 'STRING' },
    tagline: { type: 'STRING' },
    description: { type: 'STRING' },
    property_type: { type: 'STRING', enum: ['villa', 'apartment'] },
    areaname: { type: 'STRING' },
    district: { type: 'STRING' },
    license: { type: 'STRING' },
    gps: { type: 'STRING', description: 'Format "lat,lng"' },
    bedrooms: { type: 'INTEGER' },
    bathrooms: { type: 'NUMBER' },
    sleeps: { type: 'INTEGER' },
    minimum_nights: { type: 'INTEGER' },
    minimum_price: { type: 'NUMBER' },
    maximum_price: { type: 'NUMBER' },
    cleaning_charge: { type: 'NUMBER' },
    deposit: { type: 'NUMBER' },
    allow_shortstays: { type: 'STRING', enum: ['yes', 'no'] },
    features: { type: 'ARRAY', items: { type: 'STRING' } },
    notes: { type: 'STRING', description: 'Short explanation of what changed and why' },
  },
}

const PATCHABLE_KEYS = new Set([
  'villa_name', 'tagline', 'description', 'property_type', 'areaname', 'district',
  'license', 'gps', 'bedrooms', 'bathrooms', 'sleeps', 'minimum_nights',
  'minimum_price', 'maximum_price', 'cleaning_charge', 'deposit', 'allow_shortstays',
  'features',
])

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
    const currentRow = body?.current || {}
    const userText: string = (body?.text || '').toString().trim()
    const audioB64: string | null = typeof body?.audio_base64 === 'string' && body.audio_base64 ? body.audio_base64 : null
    const audioMime: string = typeof body?.audio_mime === 'string' ? body.audio_mime : 'audio/webm'

    if (!userText && !audioB64) {
      return jsonError('Provide text and/or audio', 400)
    }
    if (audioB64) {
      // base64 length ≈ bytes * 4/3
      const approxBytes = Math.floor(audioB64.length * 3 / 4)
      if (approxBytes > MAX_AUDIO_BYTES) {
        return jsonError(`Audio too large (${(approxBytes / 1024 / 1024).toFixed(1)} MB > 15 MB)`, 413)
      }
    }

    // Load amenity catalog so AI sticks to canonical labels.
    const { data: amenities } = await supaUser
      .from('amenity_catalog')
      .select('label, category')
      .eq('is_active', true)
      .order('category')
    const amenityList = (amenities || []).map((a: any) => `${a.category}: ${a.label}`).join('\n')

    const currentSnapshot = pickCurrent(currentRow)
    const systemPrompt = buildPrompt(currentSnapshot, amenityList)

    const parts: any[] = [{ text: systemPrompt }]
    if (userText) parts.push({ text: `\n--- USER INSTRUCTION (text) ---\n${userText}` })
    if (audioB64) {
      parts.push({ text: `\n--- USER INSTRUCTION (audio attached, transcribe and apply) ---` })
      parts.push({ inline_data: { mime_type: audioMime, data: audioB64 } })
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`
    let patch: any = null
    let lastError: string | null = null

    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: PATCH_SCHEMA,
          },
        }),
      })
      if (!res.ok) {
        lastError = `Gemini ${res.status}: ${await res.text()}`
        continue
      }
      const json = await res.json()
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) { lastError = 'Empty Gemini response'; continue }
      try { patch = JSON.parse(text); break } catch (e) { lastError = `Invalid JSON: ${e.message}` }
    }

    if (!patch) return jsonError(lastError || 'AI patch failed', 500)

    // Strip fields the AI may have hallucinated outside the whitelist and drop
    // entries that are unchanged from the current row (avoid noisy diff).
    const cleanPatch: Record<string, any> = {}
    let notes: string | null = null
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'notes' && typeof v === 'string') { notes = v; continue }
      if (!PATCHABLE_KEYS.has(k)) continue
      if (v === undefined || v === null) continue
      if (Array.isArray(v)) {
        const cur = Array.isArray(currentSnapshot[k]) ? currentSnapshot[k] : []
        if (sameArray(cur, v)) continue
      } else if (String(currentSnapshot[k] ?? '') === String(v)) {
        continue
      }
      cleanPatch[k] = v
    }

    return new Response(JSON.stringify({ patch: cleanPatch, notes }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('villa-ai-edit error:', err)
    return jsonError((err as Error)?.message || String(err), 500)
  }
})

function pickCurrent(row: any) {
  const out: Record<string, any> = {}
  for (const k of PATCHABLE_KEYS) out[k] = row?.[k] ?? null
  return out
}

function sameArray(a: any[], b: any[]) {
  if (a.length !== b.length) return false
  const sa = [...a].map(x => String(x)).sort()
  const sb = [...b].map(x => String(x)).sort()
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false
  return true
}

function buildPrompt(current: Record<string, any>, amenityList: string): string {
  return `You edit an existing Ibiza rental property record based on a user instruction (text and/or audio).
Return ONLY the fields that should change. Do NOT echo unchanged fields. Do NOT invent.

CURRENT VALUES (JSON):
${JSON.stringify(current, null, 2)}

RULES:
- Output text fields (tagline, description) in English regardless of the audio language.
- "description": when rewritten, keep 400-700 words, 4-6 flowing paragraphs, no bullet lists, in the existing voice. If only a small change is asked, edit in place rather than rewriting.
- "features": if changing, return the FULL replacement array (not a delta). Prefer EXACT labels from this catalog:
${amenityList}
- "gps": only if user gives coordinates or an address that resolves clearly; format "lat,lng".
- Numeric fields: emit numbers, not strings.
- "allow_shortstays": only "yes" or "no".
- "notes": one short sentence describing the change(s) you applied (for user review).
- If the instruction is ambiguous or unsafe, return an empty object (no fields) with a "notes" explaining why.

Respond with VALID JSON conforming to the schema.`
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
