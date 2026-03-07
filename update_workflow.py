import json
import os

filepath = "c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_sync.json"

with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

nodes_dict = {n["name"]: n for n in data["nodes"]}

get_prices_node = {
    "parameters": {
        "method": "POST",
        "url": "https://api.inveniohomes.com/plapi/getdata/api_villa_price",
        "sendHeaders": True,
        "headerParameters": {
            "parameters": [
                {
                    "name": "api-key",
                    "value": "R$mAx1!"
                },
                {
                    "name": "bp_uuid",
                    "value": "1cb81d6f-96b8-47eb-9ef3-910739bb8d3a"
                }
            ]
        },
        "options": {}
    },
    "type": "n8n-nodes-base.httpRequest",
    "typeVersion": 4.1,
    "position": [
        -1000,
        -1550
    ],
    "id": "fetch-prices-01",
    "name": "Invenio - Get Prices"
}

prepare_data_code = """const villasData = $('Invenio - Get Villas').first().json;
const pricesData = $('Invenio - Get Prices').first().json;

const villas = villasData.villas || [];
const price_data = pricesData.price_data || {};

const properties = [];
const prices = [];

villas.forEach(v => {
  if (v.destination !== 'Ibiza') return;

  // Add to properties
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

  // Add to prices
  const periods = price_data[v.v_uuid];
  if (Array.isArray(periods)) {
    periods.forEach(p => {
      if (p && p.start_date && p.end_date) {
        prices.push({
          v_uuid: v.v_uuid,
          start_date: p.start_date,
          end_date: p.end_date,
          amount: parseFloat(p.amount) || 0,
          currency_code: p.currency_code || null,
          unit: p.unit || null,
          minimum_nights: parseInt(p.minimum_nights) || null,
          allowed_checkin_days: p.allowed_checkin_days || null,
          last_synced_at: new Date().toISOString()
        });
      }
    });
  }
});

return [{ json: { properties: properties, prices: prices, count_prop: properties.length, count_prices: prices.length } }];"""

prepare_data_node = nodes_dict["Prepare Supabase Data"]
prepare_data_node["parameters"]["jsCode"] = prepare_data_code
prepare_data_node["position"] = [-700, -1550]
if "mode" in prepare_data_node["parameters"]:
    del prepare_data_node["parameters"]["mode"]

upsert_props_node = nodes_dict["Upsert Properties to Supabase"]
upsert_props_node["position"] = [-400, -1550]

upsert_prices_node = {
    "parameters": {
        "method": "POST",
        "url": "https://nqnwmotrjlbqdnrwcyfz.supabase.co/rest/v1/invenio_prices",
        "sendHeaders": True,
        "headerParameters": {
            "parameters": [
                {
                    "name": "apikey",
                    "value": "YOUR_SUPABASE_SERVICE_ROLE_KEY"
                },
                {
                    "name": "Authorization",
                    "value": "Bearer YOUR_SUPABASE_SERVICE_ROLE_KEY"
                },
                {
                    "name": "Prefer",
                    "value": "resolution=merge-duplicates"
                },
                {
                    "name": "Content-Type",
                    "value": "application/json"
                }
            ]
        },
        "sendBody": True,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json.prices) }}",
        "options": {}
    },
    "type": "n8n-nodes-base.httpRequest",
    "typeVersion": 4.1,
    "position": [
        -100,
        -1550
    ],
    "id": "upsert-prices-01",
    "name": "Upsert Prices to Supabase"
}

data["nodes"] = [
    nodes_dict["Schedule Trigger"],
    nodes_dict["Invenio - Get Villas"],
    get_prices_node,
    prepare_data_node,
    upsert_props_node,
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
            [{"node": "Prepare Supabase Data", "type": "main", "index": 0}]
        ]
    },
    "Prepare Supabase Data": {
        "main": [
            [{"node": "Upsert Properties to Supabase", "type": "main", "index": 0}]
        ]
    },
    "Upsert Properties to Supabase": {
        "main": [
            [{"node": "Upsert Prices to Supabase", "type": "main", "index": 0}]
        ]
    }
}

with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=4)

print("Workflow updated successfully.")
