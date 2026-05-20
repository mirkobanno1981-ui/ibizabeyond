import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ALLOWED_ROLES = ['admin', 'super_admin', 'editor', 'owner', 'agent'];

// Ibiza + Formentera bounding box (sw|ne). Biases Google to local results and
// avoids worldwide name collisions (e.g. Cala Llonga exists in Menorca).
const IBIZA_BOUNDS = '38.62,1.18|39.13,1.66';

type TargetKind = 'city' | 'area' | 'villa';

interface GeocodeRequest {
  query: string;
  target?: { kind: TargetKind; id: string | number };
  force?: boolean;
}

function normalize(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

function ensureIbizaSuffix(q: string): string {
  const lower = q.toLowerCase();
  if (lower.includes('ibiza') || lower.includes('formentera')) return q;
  return `${q}, Ibiza, Spain`;
}

async function callGoogleGeocoding(query: string, apiKey: string) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', query);
  url.searchParams.set('region', 'es');
  url.searchParams.set('bounds', IBIZA_BOUNDS);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  const json = await res.json();
  if (json.status !== 'OK' || !Array.isArray(json.results) || json.results.length === 0) {
    return { ok: false as const, raw: json };
  }
  const top = json.results[0];
  const loc = top.geometry?.location;
  if (!loc) return { ok: false as const, raw: json };
  return {
    ok: true as const,
    lat: loc.lat as number,
    lng: loc.lng as number,
    confidence: top.geometry?.location_type || 'UNKNOWN',
    raw: top,
  };
}

async function callGooglePlaces(query: string, apiKey: string) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  url.searchParams.set('query', query);
  url.searchParams.set('region', 'es');
  // bias by location around Ibiza centre with a 30km radius
  url.searchParams.set('location', '38.9067,1.4206');
  url.searchParams.set('radius', '30000');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  const json = await res.json();
  if (json.status !== 'OK' || !Array.isArray(json.results) || json.results.length === 0) {
    return { ok: false as const, raw: json };
  }
  const top = json.results[0];
  const loc = top.geometry?.location;
  if (!loc) return { ok: false as const, raw: json };
  return {
    ok: true as const,
    lat: loc.lat as number,
    lng: loc.lng as number,
    confidence: 'PLACES_TEXT_SEARCH',
    raw: top,
  };
}

function isWithinIbizaBounds(lat: number, lng: number): boolean {
  return lat >= 38.62 && lat <= 39.13 && lng >= 1.18 && lng <= 1.66;
}

function isLowConfidence(confidence: string): boolean {
  // GEOMETRIC_CENTER and APPROXIMATE are still acceptable for "indicative"
  // positioning. Only retry when Google had to fall back to nothing useful.
  return confidence === 'UNKNOWN';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const googleKey = Deno.env.get('GOOGLE_MAPS_API_KEY');

  if (!googleKey) {
    return new Response(
      JSON.stringify({ error: 'GOOGLE_MAPS_API_KEY not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Verify caller has an allowed role.
  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) {
    return new Response(
      JSON.stringify({ error: 'Missing Authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return new Response(
      JSON.stringify({ error: 'Invalid JWT' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (!roleRow || !ALLOWED_ROLES.includes(roleRow.role)) {
    return new Response(
      JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = (await req.json()) as GeocodeRequest;
    if (!body?.query || typeof body.query !== 'string') {
      throw new Error('Missing query');
    }

    const queryWithSuffix = ensureIbizaSuffix(body.query);
    const queryNorm = normalize(queryWithSuffix);

    let lat: number | null = null;
    let lng: number | null = null;
    let confidence = '';
    let provider = '';
    let cached = false;

    if (!body.force) {
      const { data: hit } = await supabase
        .from('geocode_cache')
        .select('lat, lng, confidence, provider')
        .eq('query_norm', queryNorm)
        .maybeSingle();
      if (hit) {
        lat = Number(hit.lat);
        lng = Number(hit.lng);
        confidence = hit.confidence || '';
        provider = hit.provider || '';
        cached = true;
      }
    }

    if (lat === null) {
      const geo = await callGoogleGeocoding(queryWithSuffix, googleKey);
      if (geo.ok && isWithinIbizaBounds(geo.lat, geo.lng) && !isLowConfidence(geo.confidence)) {
        lat = geo.lat;
        lng = geo.lng;
        confidence = geo.confidence;
        provider = 'geocoding';
      } else {
        const places = await callGooglePlaces(queryWithSuffix, googleKey);
        if (places.ok && isWithinIbizaBounds(places.lat, places.lng)) {
          lat = places.lat;
          lng = places.lng;
          confidence = places.confidence;
          provider = 'places';
        }
      }

      if (lat === null || lng === null) {
        return new Response(
          JSON.stringify({ error: 'No usable geocoding result within Ibiza bounds' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await supabase.from('geocode_cache').upsert({
        query_norm: queryNorm,
        lat,
        lng,
        confidence,
        provider,
      });
    }

    const gps = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    const nowIso = new Date().toISOString();

    if (body.target) {
      const { kind, id } = body.target;
      if (kind === 'city') {
        await supabase
          .from('cities')
          .update({ centroid_gps: gps, geocode_confidence: confidence, geocoded_at: nowIso })
          .eq('id', id);
      } else if (kind === 'area') {
        await supabase
          .from('areas')
          .update({ centroid_gps: gps, geocode_confidence: confidence, geocoded_at: nowIso })
          .eq('id', id);
      } else if (kind === 'villa') {
        await supabase
          .from('properties')
          .update({
            indicative_gps: gps,
            indicative_gps_source: 'villa_text',
            geocoded_at: nowIso,
          })
          .eq('v_uuid', id);
      }
    }

    return new Response(
      JSON.stringify({ gps, lat, lng, confidence, provider, cached }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('GEOCODE ERROR:', error?.message || error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
