import json

filepath = "c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_sync.json"

with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

nodes_dict = {n["name"]: n for n in data["nodes"]}

# The user provided their Supabase Key
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xbndtb3RyamxicWRucndjeWZ6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjQ0MDg1MiwiZXhwIjoyMDg4MDE2ODUyfQ.yTZHIt0EambFoKkWQ2kssdiE3A6Pz_skAY07CsYvXiU"

# Find nodes safely
prepare_data_node = nodes_dict.get("Prepare Supabase Data") or nodes_dict.get("Prepare Properties Data")

prepare_data_node["name"] = "Prepare Properties Data"
prepare_data_node["parameters"]["jsCode"] = """
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

prepare_prices_node = {
    "parameters": {
        "jsCode": """
const villasData = $('Invenio - Get Villas').first().json;
const pricesData = $('Invenio - Get Prices').first().json;

const villas = villasData.villas || [];
const price_data = pricesData.price_data || {};

const ibizaUuids = new Set(villas.filter(v => v.destination === 'Ibiza').map(v => v.v_uuid));
const prices = [];

for (const [uuid, periods] of Object.entries(price_data)) {
  if (ibizaUuids.has(uuid) && Array.isArray(periods)) {
    periods.forEach(p => {
      if (p && p.start_date && p.end_date) {
        prices.push({
          json: {
            v_uuid: uuid,
            start_date: p.start_date,
            end_date: p.end_date,
            amount: parseFloat(p.amount) || 0,
            currency_code: p.currency_code || null,
            unit: p.unit || null,
            minimum_nights: parseInt(p.minimum_nights) || null,
            allowed_checkin_days: p.allowed_checkin_days || null,
            last_synced_at: new Date().toISOString()
          }
        });
      }
    });
  }
}
return prices;
        """
    },
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [-700, -1350],
    "id": "prepare-prices-01",
    "name": "Prepare Prices Data"
}

upsert_props = nodes_dict["Upsert Properties to Supabase"]
# Inject Key
for param in upsert_props["parameters"]["headerParameters"]["parameters"]:
    if param["name"] == "apikey": param["value"] = SUPABASE_KEY
    if param["name"] == "Authorization": param["value"] = f"Bearer {SUPABASE_KEY}"

upsert_prices = nodes_dict["Upsert Prices to Supabase"]
# Restore the batched upsert payload referencing Array mapping
upsert_prices["parameters"]["jsonBody"] = "={{ JSON.stringify($input.all().map(i => i.json)) }}"
# Inject Key
for param in upsert_prices["parameters"]["headerParameters"]["parameters"]:
    if param["name"] == "apikey": param["value"] = SUPABASE_KEY
    if param["name"] == "Authorization": param["value"] = f"Bearer {SUPABASE_KEY}"

data["nodes"] = [
    nodes_dict["Schedule Trigger"],
    nodes_dict["Invenio - Get Villas"],
    nodes_dict["Invenio - Get Prices"],
    prepare_data_node,
    upsert_props,
    prepare_prices_node,
    nodes_dict["Loop Prices"],
    upsert_prices
]

data["connections"] = {
    "Schedule Trigger": {
        "main": [[{"node": "Invenio - Get Villas", "type": "main", "index": 0}]]
    },
    "Invenio - Get Villas": {
        "main": [[{"node": "Invenio - Get Prices", "type": "main", "index": 0}]]
    },
    "Invenio - Get Prices": {
        "main": [[
            {"node": "Prepare Properties Data", "type": "main", "index": 0},
            {"node": "Prepare Prices Data", "type": "main", "index": 0}
        ]]
    },
    "Prepare Properties Data": {
        "main": [[{"node": "Upsert Properties to Supabase", "type": "main", "index": 0}]]
    },
    "Prepare Prices Data": {
        "main": [[{"node": "Loop Prices", "type": "main", "index": 0}]]
    },
    "Loop Prices": {
        "main": [[{"node": "Upsert Prices to Supabase", "type": "main", "index": 0}]]
    },
    "Upsert Prices to Supabase": {
        "main": [[{"node": "Loop Prices", "type": "main", "index": 0}]]
    }
}

with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=4)

print("Workflow configured with parallel code nodes and Supabase key injected.")
