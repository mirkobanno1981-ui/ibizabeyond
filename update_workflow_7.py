import json

filepath = "c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_sync.json"

with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

nodes_dict = {n["name"]: n for n in data["nodes"]}

# 1. Update Prepare Prices Data to chunk the array securely
nodes_dict["Prepare Prices Data"]["parameters"]["jsCode"] = """
try {
  const villasNode = $('Invenio - Get Villas').first();
  const pricesNode = $('Invenio - Get Prices').first();
  
  const villasData = villasNode ? villasNode.json : {};
  const pricesData = pricesNode ? pricesNode.json : {};

  const villas = villasData.villas || [];
  const price_data = pricesData.price_data || {};

  const ibizaUuids = new Set(villas.filter(v => v.destination === 'Ibiza').map(v => v.v_uuid));
  
  const chunks = [];
  let currentChunk = [];

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
  
  if (currentChunk.length > 0) {
      chunks.push({ json: { prices: currentChunk } });
  }
  
  if (chunks.length === 0) {
     return [{ json: { message: "No prices found" } }];
  }
  
  return chunks;
} catch (error) {
  return [{ json: { error: error.message, stack: error.stack } }];
}
"""

# 2. Update Upsert Prices to Supabase 
# Because each item now carries its own array of 500 prices!
upsert_prices_node = nodes_dict["Upsert Prices to Supabase"]
upsert_prices_node["parameters"]["jsonBody"] = "={{ $json.prices ? JSON.stringify($json.prices) : '' }}"

# 3. Remove "Loop Prices" and connect "Prepare Prices Data" to "Upsert Prices to Supabase"
nodes_list = [
    nodes_dict["Schedule Trigger"],
    nodes_dict["Invenio - Get Villas"],
    nodes_dict["Invenio - Get Prices"],
    nodes_dict["Prepare Properties Data"],
    nodes_dict["Upsert Properties to Supabase"],
    nodes_dict["Prepare Prices Data"],
    upsert_prices_node
]

data["nodes"] = nodes_list

# Update connections
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
        "main": [[{"node": "Upsert Prices to Supabase", "type": "main", "index": 0}]]
    }
}

with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=4)

print("Workflow configured mapping directly to HTTP requests chunks.")
