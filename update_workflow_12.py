import json

filepath = "c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_sync.json"

with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

nodes = data["nodes"]

nodes_dict = {n["name"]: n for n in nodes}

nodes_dict["Prepare Prices Data"]["parameters"]["jsCode"] = """
try {
  const villasNode = $('Invenio - Get Villas').first();
  const pricesNode = $('Invenio - Get Prices').first();
  
  if(!villasNode) throw new Error("Could not find 'Invenio - Get Villas' node data.");
  if(!pricesNode) throw new Error("Could not find 'Invenio - Get Prices' node data.");

  const villas = villasNode.json.villas || [];
  let price_data = pricesNode.json.price_data;
  
  if (!price_data) {
    throw new Error("No price_data found inside Invenio - Get Prices response.");
  }

  // Build Ibiza UUID map
  const ibizaUuids = {};
  villas.forEach(v => {
      if (v.destination === 'Ibiza' && v.v_uuid) {
          ibizaUuids[String(v.v_uuid).trim().toLowerCase()] = true;
      }
  });
  
  const items = [];

  if (typeof price_data === 'object' && !Array.isArray(price_data)) {
    for (const [rawUuid, periods] of Object.entries(price_data)) {
      const safeUuid = String(rawUuid).trim().toLowerCase();
      
      if (ibizaUuids[safeUuid] && Array.isArray(periods)) {
        periods.forEach(p => {
          if (p && p.start_date && p.end_date) {
            items.push({
               json: {
                  v_uuid: rawUuid,
                  start_date: p.start_date,
                  end_date: p.end_date,
                  amount: parseFloat(p.amount) || 0,
                  minimum_nights: parseInt(p.minimum_nights) || 1,
                  allowed_checkin_days: p.allowed_checkin_days || null
               }
            });
          }
        });
      }
    }
  } else if (Array.isArray(price_data)) {
      price_data.forEach(p => {
         if (p && p.v_uuid) {
            const safeUuid = String(p.v_uuid).trim().toLowerCase();
            if (ibizaUuids[safeUuid] && p.start_date && p.end_date) {
                items.push({
                   json: {
                      v_uuid: p.v_uuid,
                      start_date: p.start_date,
                      end_date: p.end_date,
                      amount: parseFloat(p.amount) || 0,
                      minimum_nights: parseInt(p.minimum_nights) || 1,
                      allowed_checkin_days: p.allowed_checkin_days || null
                   }
                });
            }
         }
      });
  }
  
  if (items.length === 0) {
     return [ { json: { error: "No prices processed for Ibiza." } } ];
  }
  
  return items;
  
} catch (error) {
  return [{ json: { error: error.message, stack: error.stack } }];
}
"""

native_supabase_node = {
    "parameters": {
        "operation": "upsert",
        "tableDefinition": {
            "__rls": False,
            "mode": "list",
            "value": "invenio_seasonal_prices"
        },
        "columns": "v_uuid,start_date,end_date,amount,minimum_nights,allowed_checkin_days"
    },
    "id": "supabase-prices-01",
    "name": "Upsert Prices to Supabase",
    "type": "n8n-nodes-base.supabase",
    "typeVersion": 1,
    "position": [
        400,
        -1350
    ]
}

for i, node in enumerate(data["nodes"]):
    if node["name"] == "Upsert Prices to Supabase":
        data["nodes"][i] = native_supabase_node
        break


with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=4)

print("Updated Upsert Prices to Supabase to a Native Node.")
