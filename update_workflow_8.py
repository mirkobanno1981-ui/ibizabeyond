import json

filepath = "c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_sync.json"

with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

nodes_dict = {n["name"]: n for n in data["nodes"]}

# 1. Let's fix the empty Items issue outputted by "Prepare Prices Data".
# An item in n8n returned from a code node must be an array of objects correctly shaped.
# I had: `return [{ json: { message: "No prices found" } }];` when it fails.
# 
# Wait, let's look at `$('Invenio - Get Prices').first().json;` again.
# Invenio Get Prices response is probably:
# { 
#   "status": "success", 
#   "price_data": { "uuid1": [...], "uuid2": [...] } 
# }
# 
# If `villasNode` is empty or undefined, `pricesData` will be `{}`.
# Why would `$('Invenio - Get Villas')` be undefined?
# Because since n8n 0.198, referencing other nodes that are not direct ancestors in the SAME loop/branch 
# can sometimes fail to retrieve `.first().json` properly if the node hasn't run in this batch execution context.
# 
# To be absolutely sure, let's change our topology completely.
# Let's pass the data SEQUENTIALLY through the nodes instead of parallel branches, removing ANY context loss!
#
# Topology:
# Schedule -> Get Villas -> Get Prices -> Prepare Properties -> Upsert Properties -> Prepare Prices -> Upsert Prices
# 
# This way, each Javascript node receives the JSON directly from the `$input.first().json` or the specific named node 
# AND everything is strictly linear.

# "Prepare Properties Data"
nodes_dict["Prepare Properties Data"]["parameters"]["jsCode"] = """
// 1. Get properties from 'Invenio - Get Villas'
const villasData = $('Invenio - Get Villas').first().json;
const villas = villasData.villas || [];
const properties = [];

villas.forEach(v => {
  if (v.destination !== 'Ibiza') return;
  properties.push({
    v_uuid: v.v_uuid,
    villa_name: v.villa_name || '',
    description: v.description || null,
    tagline: v.tagline || null,
    license: v.license || null,
    bedrooms: parseInt(v.bedrooms) || 0,
    bathrooms: parseFloat(v.bathrooms) || 0,
    sleeps: parseInt(v.sleeps) || 0,
    country: v.country || null,
    destination: v.destination || null,
    areaname: v.areaname || null,
    district: v.district || null,
    gps: v.gps || null,
    cleaning: v.cleaning || null,
    cleaning_charge: parseFloat(v.cleaning_charge) || 0,
    minimum_price: parseFloat(v.minimum_price) || null,
    maximum_price: parseFloat(v.maximum_price) || null,
    deposit: parseFloat(v.deposit) || 0,
    check_in: v.check_in || null,
    check_out: v.check_out || null,
    minimum_nights: parseInt(v.minimum_nights) || 1,
    allowed_checkin_days: v.allowed_checkin_days || null,
    ical_url: v.ical_url || null,
    v_id: parseInt(v.v_id) || null,
    features: v.features || [],
    allow_shortstays: v.allow_shortstays || null,
    direct_client_contract: v.direct_client_contract || null,
    dcc_commission: v.dcc_commission || null,
    dcc_commission_vat_included: v.dcc_commission_vat_included || null,
    connected_to_owner_ical: v.connected_to_owner_ical || null,
    last_synced_at: new Date().toISOString()
  });
});
return [{ json: { properties: properties } }];
"""

# "Prepare Prices Data"
nodes_dict["Prepare Prices Data"]["parameters"]["jsCode"] = """
try {
  // Always query nodes by exact name for safety in linear path.
  const villasNode = $('Invenio - Get Villas').first();
  const pricesNode = $('Invenio - Get Prices').first();
  
  const villasData = villasNode ? villasNode.json : {};
  const pricesData = pricesNode ? pricesNode.json : {};

  // If we can't find data, return an explicit error to see what went wrong.
  if(!villasNode) throw new Error("Could not find 'Invenio - Get Villas' node data in memory.");
  if(!pricesNode) throw new Error("Could not find 'Invenio - Get Prices' node data in memory.");

  const villas = villasData.villas || [];
  const price_data = pricesData.price_data;
  
  // Notice: The Invenio API might return an Array for price_data, or an Object.
  // Actually, sometimes price_data is directly an array of objects ?
  // Let's debug what price_data is.
  if (!price_data) {
    throw new Error("No price_data found inside Invenio - Get Prices response. Keys: " + Object.keys(pricesData).join(', '));
  }

  const ibizaUuids = new Set(villas.filter(v => v.destination === 'Ibiza').map(v => v.v_uuid));
  
  const chunks = [];
  let currentChunk = [];

  // If price_data is an Array?
  if (Array.isArray(price_data)) {
    price_data.forEach(p => {
       // Support if the API returned an array instead of key=uuid objects
       if (p && ibizaUuids.has(p.v_uuid) && p.start_date && p.end_date) {
            currentChunk.push({
                v_uuid: p.v_uuid,
                start_date: p.start_date,
                end_date: p.end_date,
                amount: parseFloat(p.amount) || 0,
                currency_code: p.currency_code || null,
                unit: p.unit || null,
                minimum_nights: parseInt(p.minimum_nights) || 1,
                allowed_checkin_days: p.allowed_checkin_days || null,
                last_synced_at: new Date().toISOString()
            });
            if (currentChunk.length >= 500) {
                 chunks.push({ json: { prices: currentChunk } });
                 currentChunk = [];
            }
       }
    });

  } else {
    // Standard Object mapped by UUID as we expected
    for (const [uuid, periods] of Object.entries(price_data)) {
      if (ibizaUuids.has(uuid) && Array.isArray(periods)) {
        periods.forEach(p => {
          if (p && p.start_date && p.end_date) {
            currentChunk.push({
              v_uuid: uuid,
              start_date: p.start_date,
              end_date: p.end_date,
              amount: parseFloat(p.amount) || 0,
              currency_code: p.currency_code || null,
              unit: p.unit || null,
              minimum_nights: parseInt(p.minimum_nights) || 1,
              allowed_checkin_days: p.allowed_checkin_days || null,
              last_synced_at: new Date().toISOString()
            });
            
            if (currentChunk.length >= 500) {
               chunks.push({ json: { prices: currentChunk } });
               currentChunk = [];
            }
          }
        });
      }
    }
  }
  
  // push remaining
  if (currentChunk.length > 0) {
      chunks.push({ json: { prices: currentChunk } });
  }
  
  if (chunks.length === 0) {
     return [ { json: { error: "No prices found or mapped", sample_data_keys: Object.keys(price_data).slice(0,5).join(', ') } } ];
  }
  
  return chunks;
} catch (error) {
  return [{ json: { error: error.message, stack: error.stack } }];
}
"""

# Re-route connections to be strictly linear:
# Get Villas -> Get Prices -> Prepare Props -> Upsert Props -> Prepare Prices -> Upsert Prices

data["connections"] = {
    "Schedule Trigger": {
        "main": [[{"node": "Invenio - Get Villas", "type": "main", "index": 0}]]
    },
    "Invenio - Get Villas": {
        "main": [[{"node": "Invenio - Get Prices", "type": "main", "index": 0}]]
    },
    "Invenio - Get Prices": {
        "main": [[{"node": "Prepare Properties Data", "type": "main", "index": 0}]]
    },
    "Prepare Properties Data": {
        "main": [[{"node": "Upsert Properties to Supabase", "type": "main", "index": 0}]]
    },
    "Upsert Properties to Supabase": {
        "main": [[{"node": "Prepare Prices Data", "type": "main", "index": 0}]]
    },
    "Prepare Prices Data": {
        "main": [[{"node": "Upsert Prices to Supabase", "type": "main", "index": 0}]]
    }
}

with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=4)

print("Linear sequential workflow fixed.")
