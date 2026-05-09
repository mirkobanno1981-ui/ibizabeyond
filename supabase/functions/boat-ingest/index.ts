import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_MODEL = 'gemini-2.5-flash'
const MAX_INLINE_BYTES = 18 * 1024 * 1024

const FEATURE_CHECKLIST = [
  'wifi', 'air_conditioning', 'generator', 'water_maker', 'bow_thruster',
  'swim_platform', 'bbq', 'jacuzzi', 'sun_pads', 'bimini', 'hardtop',
  'water_toys', 'sup', 'snorkelling_gear', 'fishing_gear', 'sound_system',
  'fridge_freezer', 'ice_maker', 'dishwasher', 'washing_machine',
  'tender', 'jetski', 'seabob', 'flybridge', 'gyrostabiliser',
]

const BOAT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    boat_name: { type: 'STRING' },
    manufacturer: { type: 'STRING' },
    model: { type: 'STRING' },
    year: { type: 'INTEGER' },
    type: { type: 'STRING', enum: ['Motor', 'Sail', 'Catamaran', 'Superyacht'] },
    length_ft: { type: 'NUMBER' },
    beam_ft: { type: 'NUMBER' },
    draft_ft: { type: 'NUMBER' },
    cabins: { type: 'INTEGER' },
    bathrooms: { type: 'NUMBER' },
    guest_capacity_day: { type: 'INTEGER' },
    guest_capacity_overnight: { type: 'INTEGER' },
    base_port: { type: 'STRING' },
    skipper_type: { type: 'STRING', enum: ['Required', 'Included', 'Optional', 'Bareboat'] },
    fuel_policy: { type: 'STRING', enum: ['Paid by Consumption', 'Full to Full', 'Full-to-Full', 'APA', 'Included'] },
    daily_price: { type: 'NUMBER' },
    weekly_price: { type: 'NUMBER' },
    security_deposit: { type: 'NUMBER' },
    cleaning_fee: { type: 'NUMBER' },
    tagline: { type: 'STRING' },
    description: { type: 'STRING' },
    registration_number: { type: 'STRING' },
    features: { type: 'ARRAY', items: { type: 'STRING' } },
    photo_descriptions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          file_index: { type: 'INTEGER' },
          caption: { type: 'STRING' },
          is_cover: { type: 'BOOLEAN' },
        },
        required: ['file_index'],
      },
    },
    seasonal_prices: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          start_date: { type: 'STRING', description: 'YYYY-MM-DD' },
          end_date: { type: 'STRING', description: 'YYYY-MM-DD' },
          amount: { type: 'NUMBER', description: 'EUR per day' },
          minimum_nights: { type: 'INTEGER' },
          label: { type: 'STRING', description: 'e.g. "Low season", "High season"' },
        },
        required: ['start_date', 'end_date', 'amount'],
      },
    },
    confidence: { type: 'NUMBER' },
  },
  required: ['boat_name'],
}

interface FileRef {
  path: string
  mime: string
  kind?: 'image' | 'pdf' | 'audio' | 'text'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const geminiKey = Deno.env.get('GEMINI_API_KEY')

    if (!geminiKey) return jsonError('GEMINI_API_KEY not configured', 500)

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError('Missing Authorization header', 401)

    const supaUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const supaService = createClient(supabaseUrl, supabaseServiceKey)

    const { data: userData, error: userErr } = await supaUser.auth.getUser()
    if (userErr || !userData?.user) return jsonError('Not authenticated', 401)
    const userId = userData.user.id

    const body = await req.json()
    const action = body?.action

    if (action === 'extract') {
      return await handleExtract({ body, userId, supaUser, supaService, geminiKey })
    }
    if (action === 'commit') {
      return await handleCommit({ body, userId, supaUser, supaService, geminiKey })
    }
    return jsonError(`Unknown action: ${action}`, 400)
  } catch (err) {
    console.error('boat-ingest error:', err)
    return jsonError(err?.message || String(err), 500)
  }
})

async function handleExtract(opts: {
  body: any
  userId: string
  supaUser: any
  supaService: any
  geminiKey: string
}) {
  const { body, userId, supaUser, supaService, geminiKey } = opts
  const rawText: string = (body?.text || '').toString()
  const files: FileRef[] = Array.isArray(body?.files) ? body.files : []
  const wantMarketing: boolean = !!body?.wantMarketingDescription
  let jobId: string | undefined = body?.jobId

  if (!rawText.trim() && files.length === 0) {
    return jsonError('Provide text and/or files', 400)
  }

  // Upsert: client passes a uuid for storage path; we materialise the row keyed on the same id.
  const upsertRow: Record<string, any> = {
    user_id: userId,
    status: 'extracting',
    raw_text: rawText || null,
    file_refs: files,
  }
  if (jobId) upsertRow.id = jobId
  const { data: jobRow, error: jobErr } = await supaUser
    .from('boat_ingestion_jobs')
    .upsert(upsertRow, { onConflict: 'id' })
    .select('id')
    .single()
  if (jobErr || !jobRow) return jsonError(`Failed to create job: ${jobErr?.message}`, 500)
  jobId = jobRow.id

  // Download files via service-role.
  const fileParts: any[] = []
  let totalBytes = 0
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const { data: blob, error } = await supaService.storage
      .from('villa-ingest-tmp')
      .download(f.path)
    if (error || !blob) {
      await markFailed(supaUser, jobId!, `Failed to download ${f.path}: ${error?.message}`)
      return jsonError(`Failed to download ${f.path}: ${error?.message}`, 500)
    }
    const buf = new Uint8Array(await blob.arrayBuffer())
    totalBytes += buf.byteLength
    if (totalBytes > MAX_INLINE_BYTES) {
      await markFailed(supaUser, jobId!, 'Files exceed 18 MB cumulative limit')
      return jsonError('Files exceed 18 MB cumulative limit; reduce or compress images', 413)
    }
    fileParts.push({
      inline_data: { mime_type: f.mime, data: encodeBase64(buf) },
    })
  }

  const systemPrompt = buildSystemPrompt()
  const parts: any[] = [{ text: systemPrompt }]
  if (rawText.trim()) parts.push({ text: `\n--- USER DESCRIPTION ---\n${rawText}` })
  if (fileParts.length) parts.push({ text: `\n--- ATTACHMENTS (${fileParts.length} files) ---` })
  parts.push(...fileParts)

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`
  let extracted: any = null
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
          responseSchema: BOAT_SCHEMA,
        },
      }),
    })
    if (!res.ok) {
      lastError = `Gemini ${res.status}: ${await res.text()}`
      continue
    }
    const json = await res.json()
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      lastError = 'Gemini returned empty response'
      continue
    }
    try {
      extracted = JSON.parse(text)
      break
    } catch (e) {
      lastError = `Invalid JSON from Gemini: ${e.message}`
    }
  }

  if (!extracted) {
    await markFailed(supaUser, jobId!, lastError || 'Extraction failed')
    return jsonError(lastError || 'Extraction failed', 500)
  }

  // Conditional Call B: marketing description with Google Search grounding.
  let groundingSources: { title: string; url: string }[] = []
  const needsMarketing = wantMarketing
    || (!extracted.description && extracted.manufacturer && extracted.model)

  if (needsMarketing && extracted.manufacturer && extracted.model) {
    try {
      const yearStr = extracted.year ? ` (${extracted.year})` : ''
      const groundedPrompt = `You are a yacht charter copywriter for Ibiza. For ${extracted.manufacturer} ${extracted.model}${yearStr} write 120-180 words in English for the customer-facing site, elegant tone, focus on layout, comfort and onboard experience. Cite 1-2 official sources.`
      const gres = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: groundedPrompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.7 },
        }),
      })
      if (gres.ok) {
        const gj = await gres.json()
        const candidate = gj?.candidates?.[0]
        const groundedText = candidate?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n').trim()
        if (groundedText) extracted.description = groundedText
        const chunks = candidate?.groundingMetadata?.groundingChunks || []
        groundingSources = chunks
          .map((c: any) => c?.web ? { title: c.web.title || c.web.uri, url: c.web.uri } : null)
          .filter(Boolean)
      } else {
        console.warn('Search-grounded call failed', gres.status, await gres.text())
      }
    } catch (e) {
      console.warn('Search-grounded call error', e)
    }
  }

  // Normalise feature labels against checklist (case-insensitive match preferred).
  if (Array.isArray(extracted.features)) {
    const lower = new Map<string, string>()
    for (const f of FEATURE_CHECKLIST) lower.set(f.toLowerCase(), f)
    extracted.features = extracted.features
      .map((f: string) => lower.get(String(f).toLowerCase().replace(/\s+/g, '_')) || f)
      .filter((f: string, i: number, arr: string[]) => arr.indexOf(f) === i)
  }

  if (Array.isArray(extracted.seasonal_prices)) {
    const isoRe = /^\d{4}-\d{2}-\d{2}$/
    extracted.seasonal_prices = extracted.seasonal_prices
      .filter((r: any) =>
        r && isoRe.test(String(r.start_date)) && isoRe.test(String(r.end_date))
        && r.start_date <= r.end_date
        && Number(r.amount) > 0,
      )
      .map((r: any) => ({
        start_date: r.start_date,
        end_date: r.end_date,
        amount: Number(r.amount),
        minimum_nights: 1,
        label: r.label || null,
      }))
  } else {
    extracted.seasonal_prices = []
  }

  await supaUser
    .from('boat_ingestion_jobs')
    .update({ status: 'preview', extracted, grounding_sources: groundingSources })
    .eq('id', jobId)

  return new Response(
    JSON.stringify({
      jobId,
      extracted,
      confidence: extracted?.confidence ?? null,
      groundingSources,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
}

interface PhotoCommit { path: string; caption?: string; is_cover?: boolean }
interface SeasonalRate {
  start_date: string
  end_date: string
  amount: number
  minimum_nights?: number
  allowed_checkin_days?: string
}

async function handleCommit(opts: {
  body: any
  userId: string
  supaUser: any
  supaService: any
  geminiKey: string
}) {
  const { body, userId, supaUser, supaService } = opts
  const jobId: string | undefined = body?.jobId
  const edited = body?.edited || {}
  const photos: PhotoCommit[] = Array.isArray(edited?.photos) ? edited.photos : []
  const rates: SeasonalRate[] = Array.isArray(edited?.seasonal_rates) ? edited.seasonal_rates : []

  if (!jobId) return jsonError('jobId required', 400)
  if (!edited?.boat_name) return jsonError('boat_name required', 400)

  await supaUser
    .from('boat_ingestion_jobs')
    .update({ status: 'committing' })
    .eq('id', jobId)

  // Detect if caller is admin/super_admin to mirror BoatEditModal auto-approval.
  const { data: roleRow } = await supaUser
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle()
  const role = roleRow?.role
  const isAdmin = role === 'admin' || role === 'super_admin'

  const numericInt = (v: any) => (v === null || v === undefined || v === '' ? null : parseInt(v, 10))
  const numericFloat = (v: any) => (v === null || v === undefined || v === '' ? null : parseFloat(v))

  const insertRow: Record<string, any> = {
    boat_name: String(edited.boat_name).trim(),
    manufacturer: edited.manufacturer || null,
    model: edited.model || null,
    year: numericInt(edited.year),
    type: ['Motor', 'Sail', 'Catamaran', 'Superyacht'].includes(edited.type) ? edited.type : 'Motor',
    length_ft: numericFloat(edited.length_ft) ?? 0,
    beam_ft: numericFloat(edited.beam_ft) ?? 0,
    draft_ft: numericFloat(edited.draft_ft) ?? 0,
    cabins: numericInt(edited.cabins) ?? 0,
    bathrooms: numericFloat(edited.bathrooms) ?? 0,
    guest_capacity_day: numericInt(edited.guest_capacity_day) ?? 12,
    base_port: edited.base_port || null,
    skipper_type: ['Required', 'Included', 'Optional', 'Bareboat'].includes(edited.skipper_type) ? edited.skipper_type : 'Required',
    fuel_policy: ['Paid by Consumption', 'Full to Full', 'Full-to-Full', 'APA', 'Included'].includes(edited.fuel_policy) ? edited.fuel_policy : 'Paid by Consumption',
    daily_price: numericFloat(edited.daily_price) ?? 0,
    weekly_price: numericFloat(edited.weekly_price) ?? 0,
    security_deposit: numericFloat(edited.security_deposit) ?? 0,
    cleaning_fee: numericFloat(edited.cleaning_fee) ?? 0,
    price_locked: !!edited.price_locked,
    guest_capacity_overnight: numericInt(edited.guest_capacity_overnight) ?? 0,
    location_base_port: edited.location_base_port || edited.base_port || null,
    registration_number: edited.registration_number || null,
    tagline: edited.tagline || null,
    description: edited.description || null,
    features: Array.isArray(edited.features) ? edited.features : [],
    owner_id: edited.owner_id || null,
    created_by: userId,
    is_active: isAdmin,
    ingestion_source: 'ai_multimodal',
    ingestion_job_id: jobId,
    marketing_sources: Array.isArray(edited.marketing_sources) ? edited.marketing_sources : null,
  }

  const { data: inserted, error: insErr } = await supaUser
    .from('boats')
    .insert([insertRow])
    .select()
    .single()
  if (insErr || !inserted) {
    await markFailed(supaUser, jobId, `Insert failed: ${insErr?.message}`)
    return jsonError(`Insert failed: ${insErr?.message}`, 500)
  }
  const vUuid = inserted.v_uuid

  // Move photos from villa-ingest-tmp -> boat-photos and insert property_photos rows.
  let coverUrl: string | null = null
  let photosInserted = 0
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i]
    try {
      const { data: blob, error: dlErr } = await supaService.storage
        .from('villa-ingest-tmp')
        .download(p.path)
      if (dlErr || !blob) {
        console.error(`Skip photo (download failed): ${p.path}`, dlErr)
        continue
      }
      const ext = (p.path.split('.').pop() || 'jpg').toLowerCase()
      const destPath = `${vUuid}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supaService.storage
        .from('boat-photos')
        .upload(destPath, blob, { contentType: blob.type, upsert: false })
      if (upErr) {
        console.error(`Skip photo (upload failed): ${p.path}`, upErr)
        continue
      }
      const { data: pub } = supaService.storage.from('boat-photos').getPublicUrl(destPath)
      const url = pub?.publicUrl
      const { error: photoInsErr } = await supaService
        .from('property_photos')
        .insert({
          boat_uuid: vUuid,
          url,
          thumbnail_url: url,
          storage_path: destPath,
          caption: p.caption || null,
          sort_order: p.is_cover ? 0 : i + 1,
        })
      if (photoInsErr) {
        console.error('photo row insert failed', photoInsErr)
        continue
      }
      photosInserted++
      if (p.is_cover && !coverUrl) coverUrl = url
      await supaService.storage.from('villa-ingest-tmp').remove([p.path]).catch(() => {})
    } catch (e) {
      console.error('photo loop error', e)
    }
  }

  // Insert seasonal rates.
  let ratesInserted = 0
  let ratesError: string | null = null
  if (rates.length) {
    const rows = rates
      .filter(r => r.start_date && r.end_date && r.amount)
      .map(r => ({
        v_uuid: vUuid,
        start_date: r.start_date,
        end_date: r.end_date,
        amount: parseFloat(String(r.amount)),
        minimum_nights: 1,
        allowed_checkin_days: r.allowed_checkin_days || 'Flexible check in days',
      }))
    if (rows.length) {
      const { error: rErr, count } = await supaService
        .from('seasonal_prices')
        .insert(rows, { count: 'exact' })
      if (rErr) {
        console.error('seasonal rate insert failed', rErr)
        ratesError = rErr.message
      } else {
        ratesInserted = count ?? rows.length
      }
    }
  }

  // Update cover thumbnail.
  if (coverUrl) {
    await supaService
      .from('boats')
      .update({ thumbnail_url: coverUrl })
      .eq('v_uuid', vUuid)
  }

  await supaUser
    .from('boat_ingestion_jobs')
    .update({ status: 'completed', boat_uuid: vUuid })
    .eq('id', jobId)

  return new Response(
    JSON.stringify({
      v_uuid: vUuid,
      photos_inserted: photosInserted,
      rates_inserted: ratesInserted,
      rates_error: ratesError,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
}

function buildSystemPrompt(): string {
  return `You extract structured information about charter boats based in Ibiza for a luxury rental platform.
Inputs may include free text, photos, manufacturer brochures (PDF), or audio recordings (English/Italian/Spanish).
Output MUST be a JSON object matching the provided schema.

Guidelines:
- Omit fields you cannot infer from the inputs (do NOT invent).
- "type": Motor = motor yacht / power boat; Sail = sailing yacht; Catamaran = multi-hull; Superyacht = >24 m / >80 ft luxury yacht.
- "skipper_type": Required = skipper mandatory and included; Optional = skipper offered separately; Bareboat = no skipper.
- "fuel_policy": "Paid by Consumption" = client pays fuel by usage; "Full to Full" = return with full tanks; "Included" = fuel covered.
- "features": choose preferred labels from this checklist when applicable (lowercase, snake_case):
${FEATURE_CHECKLIST.map(f => `  - ${f}`).join('\n')}
  Free-form labels are allowed only when nothing in the checklist matches.
- "photo_descriptions": file_index = 0-based position of image attachments. Mark is_cover=true on AT MOST one photo (the most representative exterior or aerial shot).
- "daily_price"/"weekly_price": EUR. If only daily is given do not invent weekly.
- "security_deposit": refundable damage deposit in EUR.
- "guest_capacity_day": max guests for day charter; "guest_capacity_overnight": berths for overnight stays.
- "seasonal_prices": if the source contains a seasonal/period price table (e.g. "Low season 01/04-15/06: €4,500/day", "High season 16/06-31/08: €7,000/day"), emit ONE entry per period. Use ISO YYYY-MM-DD dates. If only a season label is given without dates, infer typical Ibiza dates: Low ≈ 01/04-31/05 + 01/10-31/10, Mid ≈ 01/06-30/06 + 01/09-30/09, High ≈ 01/07-31/08. If amounts are weekly only, divide by 7 to get daily. If only one daily_price exists with no period table, leave seasonal_prices empty.
- "confidence": 0..1 — overall extraction confidence.

Reply ONLY with valid JSON conforming to the schema.`
}

async function markFailed(supabase: any, jobId: string, error: string) {
  try {
    await supabase
      .from('boat_ingestion_jobs')
      .update({ status: 'failed', error })
      .eq('id', jobId)
  } catch (_) { /* ignore */ }
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
