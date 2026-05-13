import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_MODEL = 'gemini-2.5-flash'
const EMBEDDING_MODEL = 'gemini-embedding-001'
const EMBEDDING_DIM = 768
const MAX_INLINE_BYTES = 18 * 1024 * 1024 // ~18 MB safety margin under 20 MB Gemini cap

const RENTAL_TYPES = ['daily', 'monthly', 'seasonal', 'annual'] as const

// JSON-Schema (subset) for Gemini structured output. Keep aligned with properties table.
const PROPERTY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    villa_name: { type: 'STRING' },
    property_type: { type: 'STRING', enum: ['villa', 'apartment', 'finca'] },
    areaname: { type: 'STRING' },
    district: { type: 'STRING' },
    bedrooms: { type: 'INTEGER' },
    bathrooms: { type: 'INTEGER' },
    sleeps: { type: 'INTEGER' },
    minimum_nights: { type: 'INTEGER' },
    minimum_price: { type: 'NUMBER' },
    maximum_price: { type: 'NUMBER' },
    cleaning_charge: { type: 'NUMBER' },
    deposit: { type: 'NUMBER' },
    tagline: { type: 'STRING' },
    description: { type: 'STRING' },
    license: { type: 'STRING' },
    gps: { type: 'STRING', description: 'Format "lat,lng" if location can be inferred' },
    allow_shortstays: { type: 'STRING', enum: ['yes', 'no'] },
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
    rental_types: {
      type: 'ARRAY',
      description: 'Rental modes the property is offered under, if explicit in the source.',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['daily', 'monthly', 'seasonal', 'annual'] },
          enabled: { type: 'BOOLEAN' },
          typical_price: { type: 'NUMBER', description: 'Indicative EUR rate for this rental mode (per night for daily, per month for monthly, per season/year otherwise).' },
        },
        required: ['type', 'enabled'],
      },
    },
    seasonal_prices: {
      type: 'ARRAY',
      description: 'One entry per pricing period, EUR per night.',
      items: {
        type: 'OBJECT',
        properties: {
          start_date: { type: 'STRING', description: 'YYYY-MM-DD' },
          end_date: { type: 'STRING', description: 'YYYY-MM-DD' },
          amount: { type: 'NUMBER', description: 'EUR per night' },
          minimum_nights: { type: 'INTEGER' },
          label: { type: 'STRING', description: 'e.g. "Low season", "High season"' },
        },
        required: ['start_date', 'end_date', 'amount'],
      },
    },
    confidence: { type: 'NUMBER' },
  },
  required: ['villa_name'],
}

interface FileRef {
  path: string
  mime: string
  kind?: 'image' | 'pdf' | 'audio' | 'video' | 'text'
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

    if (!geminiKey) {
      return jsonError('GEMINI_API_KEY not configured', 500)
    }

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
      return await handleExtract({
        body,
        userId,
        supaUser,
        supaService,
        geminiKey,
      })
    }

    if (action === 'commit') {
      return await handleCommit({
        body,
        userId,
        supaUser,
        supaService,
        geminiKey,
      })
    }

    return jsonError(`Unknown action: ${action}`, 400)
  } catch (err) {
    console.error('property-ingest error:', err)
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
  let jobId: string | undefined = body?.jobId

  if (!rawText.trim() && files.length === 0) {
    return jsonError('Provide text and/or files', 400)
  }

  // Create or load job (RLS-scoped — user_id = auth.uid()).
  if (!jobId) {
    const { data, error } = await supaUser
      .from('property_ingestion_jobs')
      .insert({
        user_id: userId,
        status: 'extracting',
        raw_text: rawText || null,
        file_refs: files,
      })
      .select('id')
      .single()
    if (error) return jsonError(`Failed to create job: ${error.message}`, 500)
    jobId = data.id
  } else {
    await supaUser
      .from('property_ingestion_jobs')
      .update({ status: 'extracting', raw_text: rawText || null, file_refs: files })
      .eq('id', jobId)
  }

  // Load amenity catalog labels for prompt guidance.
  const { data: amenities } = await supaUser
    .from('amenity_catalog')
    .select('label, category')
    .eq('is_active', true)
    .order('category')
  const amenityList = (amenities || []).map((a: any) => `${a.category}: ${a.label}`).join('\n')

  // Pull a handful of high-quality existing villa descriptions to anchor the
  // model's writing style (tone, paragraph cadence, target length). Service-role
  // read so we are not blocked by RLS on inactive rows.
  const { data: styleSamples } = await supaService
    .from('properties')
    .select('villa_name, tagline, description')
    .eq('is_active', true)
    .not('description', 'is', null)
    .limit(80)
  const longSamples = (styleSamples || []).filter((s: any) => (s.description || '').length >= 400)
  const pickedSamples = pickRandom(longSamples, 6)
  const styleBlock = pickedSamples
    .map((s: any, i: number) => `### Example ${i + 1}: ${s.villa_name}\nTagline: ${s.tagline || '(none)'}\nDescription:\n${s.description}`)
    .join('\n\n')

  // Download all files via service-role (bypasses storage RLS for bucket reads).
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
      inline_data: {
        mime_type: f.mime,
        data: encodeBase64(buf),
      },
    })
  }

  const systemPrompt = buildSystemPrompt(amenityList, styleBlock)

  const parts: any[] = [{ text: systemPrompt }]
  if (rawText.trim()) parts.push({ text: `\n--- USER / SOURCE TEXT ---\n${rawText}` })
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
          responseSchema: PROPERTY_SCHEMA,
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

  // Post-process features against amenity_catalog (case-insensitive match).
  if (Array.isArray(extracted.features) && amenities) {
    const labelMap = new Map<string, string>()
    for (const a of amenities) labelMap.set(a.label.toLowerCase(), a.label)
    extracted.features = extracted.features
      .map((f: string) => labelMap.get(String(f).toLowerCase()) || f)
      .filter((f: string, i: number, arr: string[]) => arr.indexOf(f) === i)
  }

  // Sanitise seasonal_prices: ISO dates, positive amount, ordered.
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
        minimum_nights: r.minimum_nights ? parseInt(String(r.minimum_nights), 10) : 7,
        label: r.label || null,
      }))
  } else {
    extracted.seasonal_prices = []
  }

  // Normalise rental_types into rental_type_configs map keyed by type.
  const validRental = new Set(RENTAL_TYPES)
  const rentalConfigs: Record<string, { enabled: boolean; typical_price?: number }> = {}
  if (Array.isArray(extracted.rental_types)) {
    for (const r of extracted.rental_types) {
      const t = String(r?.type || '').toLowerCase()
      if (!validRental.has(t as any)) continue
      const enabled = !!r.enabled
      const price = r.typical_price !== undefined && r.typical_price !== null && r.typical_price !== ''
        ? Number(r.typical_price)
        : undefined
      rentalConfigs[t] = { enabled, ...(Number.isFinite(price as number) ? { typical_price: price } : {}) }
    }
  }
  // If nothing extracted but a daily price exists, mark daily enabled by default.
  if (Object.keys(rentalConfigs).length === 0 && (extracted.minimum_price || extracted.maximum_price)) {
    rentalConfigs.daily = { enabled: true }
  }
  extracted.rental_type_configs = rentalConfigs

  await supaUser
    .from('property_ingestion_jobs')
    .update({ status: 'preview', extracted })
    .eq('id', jobId)

  return new Response(
    JSON.stringify({ jobId, extracted, confidence: extracted?.confidence ?? null }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
}

interface PhotoCommit {
  path: string                  // path in villa-ingest-tmp
  caption?: string
  is_cover?: boolean
}

interface VideoCommit {
  path: string
  caption?: string
}

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
  const { body, userId, supaUser, supaService, geminiKey } = opts
  const jobId: string | undefined = body?.jobId
  const edited = body?.edited || {}
  const photos: PhotoCommit[] = Array.isArray(edited?.photos) ? edited.photos : []
  const videos: VideoCommit[] = Array.isArray(edited?.videos) ? edited.videos : []
  const rates: SeasonalRate[] = Array.isArray(edited?.seasonal_rates) ? edited.seasonal_rates : []

  if (!jobId) return jsonError('jobId required', 400)
  if (!edited?.villa_name) return jsonError('villa_name required', 400)

  await supaUser
    .from('property_ingestion_jobs')
    .update({ status: 'committing' })
    .eq('id', jobId)

  // Build INSERT row from whitelist of editable fields.
  const numericInt = (v: any) => (v === null || v === undefined || v === '' ? null : parseInt(v, 10))
  const numericFloat = (v: any) => (v === null || v === undefined || v === '' ? null : parseFloat(v))

  const insertRow: Record<string, any> = {
    villa_name: String(edited.villa_name).trim(),
    property_type: edited.property_type === 'apartment' ? 'apartment' : 'villa',
    areaname: edited.areaname || null,
    district: edited.district || null,
    bedrooms: numericInt(edited.bedrooms) ?? 0,
    bathrooms: numericFloat(edited.bathrooms) ?? 0,
    sleeps: numericInt(edited.sleeps) ?? 0,
    minimum_nights: numericInt(edited.minimum_nights) ?? 7,
    minimum_price: numericFloat(edited.minimum_price) ?? 0,
    maximum_price: numericFloat(edited.maximum_price) ?? 0,
    cleaning_charge: numericFloat(edited.cleaning_charge) ?? 0,
    deposit: numericFloat(edited.deposit) ?? 0,
    tagline: edited.tagline || null,
    description: edited.description || null,
    license: edited.license || null,
    gps: edited.gps || null,
    allow_shortstays: edited.allow_shortstays === 'yes' ? 'yes' : 'no',
    features: Array.isArray(edited.features) ? edited.features : [],
    rental_type_configs: edited.rental_type_configs && typeof edited.rental_type_configs === 'object'
      ? edited.rental_type_configs
      : {},
    source: 'manual',
    ingestion_source: 'ai_multimodal',
    ingestion_job_id: jobId,
    created_by: userId,
    is_active: false, // requires super_admin approval (mirrors VillaEditModal logic for non-admins)
  }

  // INSERT property via user-scoped client → RLS enforced.
  const { data: inserted, error: insErr } = await supaUser
    .from('properties')
    .insert([insertRow])
    .select()
    .single()
  if (insErr || !inserted) {
    await markFailed(supaUser, jobId, `Insert failed: ${insErr?.message}`)
    return jsonError(`Insert failed: ${insErr?.message}`, 500)
  }
  const vUuid = inserted.v_uuid

  // Move photos from villa-ingest-tmp to villa-photos and insert property_photos rows.
  let coverUrl: string | null = null
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
        .from('villa-photos')
        .upload(destPath, blob, { contentType: blob.type, upsert: false })
      if (upErr) {
        console.error(`Skip photo (upload failed): ${p.path}`, upErr)
        continue
      }
      const { data: pub } = supaService.storage.from('villa-photos').getPublicUrl(destPath)
      const url = pub?.publicUrl
      const { error: photoInsErr } = await supaService
        .from('property_photos')
        .insert({
          v_uuid: vUuid,
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
      if (p.is_cover && !coverUrl) coverUrl = url
      // Best-effort cleanup transient.
      await supaService.storage.from('villa-ingest-tmp').remove([p.path]).catch(() => {})
    } catch (e) {
      console.error('photo loop error', e)
    }
  }

  // Move videos from villa-ingest-tmp -> villa-videos and insert property_videos rows.
  let videosInserted = 0
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i]
    try {
      const { data: blob, error: dlErr } = await supaService.storage
        .from('villa-ingest-tmp')
        .download(v.path)
      if (dlErr || !blob) {
        console.error(`Skip video (download failed): ${v.path}`, dlErr)
        continue
      }
      const ext = (v.path.split('.').pop() || 'mp4').toLowerCase()
      const destPath = `${vUuid}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supaService.storage
        .from('villa-videos')
        .upload(destPath, blob, { contentType: blob.type, upsert: false })
      if (upErr) {
        console.error(`Skip video (upload failed): ${v.path}`, upErr)
        continue
      }
      const { data: pub } = supaService.storage.from('villa-videos').getPublicUrl(destPath)
      const url = pub?.publicUrl
      const { error: vErr } = await supaService
        .from('property_videos')
        .insert({
          v_uuid: vUuid,
          url,
          storage_path: destPath,
          caption: v.caption || null,
          sort_order: i,
          created_by: userId,
        })
      if (vErr) {
        console.error('video row insert failed', vErr)
        continue
      }
      videosInserted++
      await supaService.storage.from('villa-ingest-tmp').remove([v.path]).catch(() => {})
    } catch (e) {
      console.error('video loop error', e)
    }
  }

  // Insert seasonal rates.
  let ratesInserted = 0
  if (rates.length) {
    const isoRe = /^\d{4}-\d{2}-\d{2}$/
    const rows = rates
      .filter(r => r.start_date && r.end_date && r.amount
        && isoRe.test(String(r.start_date)) && isoRe.test(String(r.end_date)))
      .map(r => ({
        v_uuid: vUuid,
        start_date: r.start_date,
        end_date: r.end_date,
        amount: parseFloat(String(r.amount)),
        minimum_nights: r.minimum_nights ? parseInt(String(r.minimum_nights), 10) : 7,
        allowed_checkin_days: r.allowed_checkin_days || 'Flexible check in days',
      }))
    if (rows.length) {
      const { error: rErr, count } = await supaService
        .from('seasonal_prices')
        .insert(rows, { count: 'exact' })
      if (rErr) console.error('seasonal rate insert failed', rErr)
      else ratesInserted = count ?? rows.length
    }
  }

  // Generate embedding (gemini-embedding-001, 768 dim).
  const embedText = [
    insertRow.villa_name,
    insertRow.areaname,
    insertRow.district,
    insertRow.tagline,
    insertRow.description,
    Array.isArray(insertRow.features) ? insertRow.features.join(', ') : null,
  ].filter(Boolean).join('\n')

  let embeddingValues: number[] | null = null
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text: embedText }] },
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: EMBEDDING_DIM,
        }),
      },
    )
    if (r.ok) {
      const j = await r.json()
      embeddingValues = j?.embedding?.values || null
    } else {
      console.error('Embedding error', r.status, await r.text())
    }
  } catch (e) {
    console.error('Embedding fetch failed', e)
  }

  // Update embedding + cover thumbnail (service-role to avoid touching user-RLS write rules).
  const updatePatch: Record<string, any> = { embedding_text: embedText }
  if (embeddingValues) updatePatch.embedding = embeddingValues
  if (coverUrl) updatePatch.thumbnail_url = coverUrl
  await supaService
    .from('properties')
    .update(updatePatch)
    .eq('v_uuid', vUuid)

  await supaUser
    .from('property_ingestion_jobs')
    .update({ status: 'completed', v_uuid: vUuid })
    .eq('id', jobId)

  return new Response(JSON.stringify({
    v_uuid: vUuid,
    embedding_ok: !!embeddingValues,
    videos_inserted: videosInserted,
    rates_inserted: ratesInserted,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function buildSystemPrompt(amenityList: string, styleBlock: string): string {
  const styleSection = styleBlock
    ? `\n--- HOUSE STYLE EXAMPLES (match this voice, paragraph rhythm and target length) ---\n${styleBlock}\n--- END EXAMPLES ---\n`
    : ''
  return `You extract structured information about Ibiza rental properties from text, photos, PDF brochures, audio (Italian/English/Spanish) and video tours.
Produce a JSON object matching the provided schema. ALL output text MUST be written in English regardless of the source language.

Translate any non-English source content into natural English before placing it in tagline/description/feature fields.

GENERAL RULES:
- If a field is not derivable from the sources, omit it. Never invent.
- "property_type": villa = standalone house with garden/pool; apartment = unit inside a building; finca = rustic country house.
- "confidence": 0..1, your overall extraction confidence.

DESCRIPTION & TAGLINE (most important):
- Write in English, in the same voice, register and structural cadence as the HOUSE STYLE EXAMPLES below.
- Match the typical length of those examples (usually 250-500 words split into 2-4 paragraphs). If sources are very sparse, still write at least one rich paragraph rather than a single sentence.
- Open with a hook describing the setting/location and atmosphere; then describe the property's spaces (living, kitchen, bedrooms, bathrooms, outdoor area, pool, views); close with a line on the lifestyle / type of guest it suits.
- Weave in concrete, visible details from photos: materials (stone, wood, white-washed walls, travertine), furniture style, lighting, layout flow, terraces, sun loungers, BBQ, sea/sunset/countryside views, nearby beaches/towns.
- Do NOT use bullet lists in the description — flowing prose only. No marketing clichés like "a dream come true"; mirror the examples' restraint.
- "tagline": one short evocative line (max ~12 words), English, same register as examples.

FEATURES (be exhaustive):
- Inspect EVERY photo, page and sentence. List every amenity you can confirm: pool type, jacuzzi, sea/sunset view, A/C, heating, fireplace, BBQ, outdoor kitchen, dining areas, sun loungers, terraces, garden, parking, EV charger, gym, sauna, hammam, cinema room, smart TV, sound system, Wi-Fi, baby cot, high chair, washing machine, dishwasher, safe, alarm, gated access, staff/concierge, etc.
- Prefer EXACT labels (case-sensitive) from this catalog:
${amenityList}
  Add free-text labels ONLY when nothing in the catalog matches. Do not duplicate.

CAPACITY / PRICING:
- "bedrooms"/"bathrooms"/"sleeps": prefer explicit figures; otherwise count bedrooms visible in floor plans / photos.
- "minimum_price"/"maximum_price": EUR per night, seasonal range if present.
- "rental_types": list only modes EXPLICITLY offered in the source. Valid: daily, monthly, seasonal, annual. Set enabled=true if cited; include typical_price when given. Do NOT infer unmentioned modes.
- "seasonal_prices": if a per-period rate table is present (e.g. "Low season 01/04-15/06: €800/night"), emit one entry per period with ISO YYYY-MM-DD dates. If only a seasonal label without dates is given, infer typical Ibiza ranges: Low ≈ 01/04-31/05 + 01/10-31/10, Mid ≈ 01/06-30/06 + 01/09-30/09, High ≈ 01/07-31/08. If prices are weekly, divide by 7. If only a single nightly price exists with no period, leave seasonal_prices empty.

PHOTOS:
- "photo_descriptions": index by file_index = 0-based position among IMAGE files attached (skip video/audio/PDF when counting). Mark is_cover=true on AT MOST ONE photo — usually an exterior shot showing pool, view or the building's most representative angle.
- "caption": short English caption describing the specific space/view in the photo.

AUDIO / VIDEO:
- Audio: mentally transcribe, then extract only property-relevant facts.
- Video: extract visible details (views, finishes, spaces) as you would from photos.
${styleSection}
Respond with VALID JSON only, conforming to the schema.`
}

function pickRandom<T>(arr: T[], n: number): T[] {
  if (!arr.length) return []
  const copy = arr.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, Math.min(n, copy.length))
}

async function markFailed(supabase: any, jobId: string, error: string) {
  try {
    await supabase
      .from('property_ingestion_jobs')
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
