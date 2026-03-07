import json

filepath = "c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_sync.json"

with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

# The user is experiencing UI parameter mismatch errors because we injected 
# a Supabase node without the exact n8n UI parameters (e.g. `upsert` vs `insert`).
# Supabase's native REST API handles Upserts flawlessly via headers.
# Let's revert the node to an HTTP Request.

# First, modify the Prepare Prices Data to output a single array payload for HTTP Request batching, 
# instead of flat n8n items. Wait, if we use HTTP Request, we need the payload to be an array of objects.
# Flat n8n items look like: `[ { json: { v_uuid: ... } }, { json: { v_uuid: ... } } ]`
# If we do `{{ JSON.stringify($input.all().map(i => i.json)) }}`, we can send it all.
# Or we can change Prepare Prices Data to output chunks of 500 inside `json.prices` like before, 
# which is actually MORE efficient for HTTP requests to avoid 413 Payload Too Large!

nodes_dict = {n["name"]: n for n in data["nodes"]}

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
  
  const chunks = [];
  let currentChunk = [];

  if (typeof price_data === 'object' && !Array.isArray(price_data)) {
    for (const [rawUuid, periods] of Object.entries(price_data)) {
      const safeUuid = String(rawUuid).trim().toLowerCase();
      
      if (ibizaUuids[safeUuid] && Array.isArray(periods)) {
        periods.forEach(p => {
          if (p && p.start_date && p.end_date) {
            currentChunk.push({
               v_uuid: rawUuid,
               start_date: p.start_date,
               end_date: p.end_date,
               amount: parseFloat(p.amount) || 0,
               minimum_nights: parseInt(p.minimum_nights) || 1,
               allowed_checkin_days: p.allowed_checkin_days || null
            });
            if (currentChunk.length >= 500) {
                 chunks.push({ json: { prices: currentChunk } });
                 currentChunk = [];
            }
          }
        });
      }
    }
  } else if (Array.isArray(price_data)) {
      price_data.forEach(p => {
         if (p && p.v_uuid) {
            const safeUuid = String(p.v_uuid).trim().toLowerCase();
            if (ibizaUuids[safeUuid] && p.start_date && p.end_date) {
                currentChunk.push({
                   v_uuid: p.v_uuid,
                   start_date: p.start_date,
                   end_date: p.end_date,
                   amount: parseFloat(p.amount) || 0,
                   minimum_nights: parseInt(p.minimum_nights) || 1,
                   allowed_checkin_days: p.allowed_checkin_days || null
                });
                if (currentChunk.length >= 500) {
                     chunks.push({ json: { prices: currentChunk } });
                     currentChunk = [];
                }
            }
         }
      });
  }
  
  if (currentChunk.length > 0) {
      chunks.push({ json: { prices: currentChunk } });
  }
  
  if (chunks.length === 0) {
     return [ { json: { error: "No prices processed for Ibiza." } } ];
  }
  
  return chunks;
  
} catch (error) {
  return [{ json: { error: error.message, stack: error.stack } }];
}
"""

http_supabase_node = {
    "parameters": {
        "method": "POST",
        "url": "https://nqnwmotrjlbqdnrwcyfz.supabase.co/rest/v1/invenio_seasonal_prices",
        "sendHeaders": True,
        "headerParameters": {
            "parameters": [
                {
                    "name": "apikey",
                    "value": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xbndtb3RyamxicWRucndjeWZ6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjQ0MDg1MiwiZXhwIjoyMDg4MDE2ODUyfQ.yTZHIt0EambFoKkWQ2kssdiE3A6Pz_skAY07CsYvXiU"
                },
                {
                    "name": "Authorization",
                    "value": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xbndtb3RyamxicWRucndjeWZ6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjQ0MDg1MiwiZXhwIjoyMDg4MDE2ODUyfQ.yTZHIt0EambFoKkWQ2kssdiE3A6Pz_skAY07CsYvXiU"
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
        "jsonBody": "={{ $json.prices ? JSON.stringify($json.prices) : '[]' }}",
        "options": {}
    },
    "type": "n8n-nodes-base.httpRequest",
    "typeVersion": 4.1,
    "position": [
        400,
        -1350
    ],
    "id": "upsert-prices-01",
    "name": "Upsert Prices to Supabase"
}

for i, node in enumerate(data["nodes"]):
    if node["name"] == "Upsert Prices to Supabase":
        data["nodes"][i] = http_supabase_node
        break

with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=4)

print("Reverted to HTTP Request for Upsert Prices.")
