import json

filepath = "c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_sync.json"

with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

nodes_dict = {n["name"]: n for n in data["nodes"]}

# 1. The problem is that n8n's "Item Lists" node requires the array to be inside
# each item's JSON, and by processing 100 properties we created a single item containing
# { properties: [...], prices: [...] }. Sometimes n8n struggles to memory-manage
# or split a massive 5000+ item array from a single JSON property.

# FIX: We will remove "Split Prices".
# We will use TWO separate Code nodes after fetching data, or we just rely on one Code node
# that outputs TWO DIFFERENT arrays of items explicitly using n8n's multi-output feature.
# n8n Code nodes can return multiple runs `[ itemsArray ]`, but if we use multiple outputs
# we can return `[ propertiesItems, pricesItems ]` and route them separately.
# However, the simplest n8n approach is formatting the output from "Prepare Supabase Data"
# as a single item `{ properties: [...] }` AND passing the raw `pricesData` down,
# OR we do the Upsert Properties, and then add a "Prepare Prices Data" Code node.

# Let's cleanly separate concerns:
# 1. "Prepare Properties Data" -> Upsert Properties
# 2. "Prepare Prices Data" -> Loop Prices -> Upsert Prices

# We will repurpose "Prepare Supabase Data" strictly for Properties.
nodes_dict["Prepare Supabase Data"]["name"] = "Prepare Properties Data"
nodes_dict["Prepare Properties Data"]["parameters"]["jsCode"] = """
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


# Add a new Code Node "Prepare Prices Data"
prepare_prices_node = {
    "parameters": {
        "jsCode": """
const villasData = $('Invenio - Get Villas').first().json;
const pricesData = $('Invenio - Get Prices').first().json;

const villas = villasData.villas || [];
const price_data = pricesData.price_data || {};

const ibizaUuids = new Set(villas.filter(v => v.destination === 'Ibiza').map(v => v.v_uuid));
const prices = [];

// Output as individual n8n items, not a single array inside one item
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
    "position": [
        -700,
        -1350
    ],
    "id": "prepare-prices-01",
    "name": "Prepare Prices Data"
}

# The Loop Prices node takes individual items now
# Upsert Prices takes the grouped JSON array from the Loop output:
upsert_prices_node = nodes_dict["Upsert Prices to Supabase"]
upsert_prices_node["parameters"]["jsonBody"] = "={{ JSON.stringify($input.all().map(i => i.json)) }}"

# Fix connections
data["nodes"] = [
    nodes_dict["Schedule Trigger"],
    nodes_dict["Invenio - Get Villas"],
    nodes_dict["Invenio - Get Prices"],
    nodes_dict["Prepare Properties Data"],
    nodes_dict["Upsert Properties to Supabase"],
    prepare_prices_node,
    nodes_dict["Loop Prices"],
    upsert_prices_node
]

data["connections"] = {
    "Schedule Trigger": {
        "main": [
            [{"node": "Invenio - Get Villas", "type": "main", "index": 0}]
        ]
    },
    "Invenio - Get Villas": {
        "main": [
            [{"node": "Invenio - Get Prices", "type": "main", "index": 0}]
        ]
    },
    "Invenio - Get Prices": {
        "main": [
            [
                {"node": "Prepare Properties Data", "type": "main", "index": 0},
                {"node": "Prepare Prices Data", "type": "main", "index": 0}
            ]
        ]
    },
    "Prepare Properties Data": {
        "main": [
            [{"node": "Upsert Properties to Supabase", "type": "main", "index": 0}]
        ]
    },
    "Prepare Prices Data": {
        "main": [
            [{"node": "Loop Prices", "type": "main", "index": 0}]
        ]
    },
    "Loop Prices": {
        "main": [
            [{"node": "Upsert Prices to Supabase", "type": "main", "index": 0}]
        ]
    },
    "Upsert Prices to Supabase": {
        "main": [
            [{"node": "Loop Prices", "type": "main", "index": 0}]
        ]
    }
}

with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=4)

print("Workflow separated into two parallel cleaner code nodes.")
