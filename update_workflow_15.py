import json

filepath = "c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_sync.json"

with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

# The user wants ONLY native Supabase nodes.
# And a condition: "If exists UPDATE, else INSERT".

nodes = []

# Keep the base triggers and fetchers
base_nodes = ["Schedule Trigger", "Invenio - Get Villas", "Invenio - Get Prices", "Prepare Properties Data"]
for n in data["nodes"]:
    if n["name"] in base_nodes:
        nodes.append(n)

# 1. Native Supabase for Properties (Upsert works here because v_uuid IS a Primary Key in invenio_properties)
nodes.append({
    "parameters": {
        "operation": "upsert",
        "tableDefinition": {
            "__rls": False,
            "mode": "list",
            "value": "invenio_properties"
        },
        "tableId": "invenio_properties",
        "dataMode": "autoMapInputData"
    },
    "id": "native-props-01",
    "name": "Native Upsert Properties",
    "type": "n8n-nodes-base.supabase",
    "typeVersion": 1,
    "position": [-400, -1550]
})

# 2. Native Supabase node to GET ALL existing prices for Ibiza
nodes.append({
    "parameters": {
        "operation": "getAll",
        "tableDefinition": {
            "__rls": False,
            "mode": "list",
            "value": "invenio_seasonal_prices"
        },
        "tableId": "invenio_seasonal_prices",
        "returnAll": True
    },
    "id": "native-get-prices-01",
    "name": "Get Existing Prices from Supabase",
    "type": "n8n-nodes-base.supabase",
    "typeVersion": 1,
    "position": [-100, -1550]
})

# 3. Compare and Split Code Node
# This node takes data from Invenio Prices AND Supabase Existing Prices.
# It aligns them by v_uuid and start_date.
js_code_split = """
try {
  const villasNode = $('Invenio - Get Villas').first();
  const invenioPricesNode = $('Invenio - Get Prices').first();
  
  // Existing Supabase prices from the previous node
  const existingPrices = $input.all().map(i => i.json); 

  if (!villasNode) throw new Error("Could not find Villas data.");
  if (!invenioPricesNode) throw new Error("Could not find Invenio Prices data.");

  const villas = villasNode.json.villas || [];
  const rawPriceData = invenioPricesNode.json.price_data || {};

  // 1. Build a fast lookup for existing Supabase prices based on v_uuid + start_date
  // So we know if we need to UPDATE or INSERT
  const existingMap = {};
  existingPrices.forEach(ep => {
      const safeUuid = String(ep.v_uuid).trim().toLowerCase();
      const safeDate = String(ep.start_date).trim();
      const key = `${safeUuid}_${safeDate}`;
      existingMap[key] = ep.id; // Store the Supabase Primary Key 'id' needed for updating!
  });

  // 2. Identify Ibiza UUIDs
  const ibizaUuids = {};
  villas.forEach(v => {
      if (v.destination === 'Ibiza' && v.v_uuid) {
          ibizaUuids[String(v.v_uuid).trim().toLowerCase()] = true;
      }
  });

  const inserts = [];
  const updates = [];

  // Function to process a single price period
  function processPeriod(rawUuid, p) {
      if (!p || !p.start_date || !p.end_date) return;
      
      const safeUuid = String(rawUuid).trim().toLowerCase();
      if (!ibizaUuids[safeUuid]) return; // Skip non-Ibiza
      
      const safeDate = String(p.start_date).trim();
      const key = `${safeUuid}_${safeDate}`;

      const itemPayload = {
          v_uuid: rawUuid, // Use original case for DB
          start_date: p.start_date,
          end_date: p.end_date,
          amount: parseFloat(p.amount) || 0,
          minimum_nights: parseInt(p.minimum_nights) || 1,
          allowed_checkin_days: p.allowed_checkin_days || null
      };

      if (existingMap[key]) {
          // Exists -> We must UPDATE. We inject the Supabase 'id' so the Update node knows which row to target.
          itemPayload.id = existingMap[key];
          updates.push({ json: itemPayload });
      } else {
          // Does not exist -> We must INSERT
          inserts.push({ json: itemPayload });
      }
  }

  // 3. Process Invenio data (handles both Array and Object mappings)
  if (typeof rawPriceData === 'object' && !Array.isArray(rawPriceData)) {
      for (const [rawUuid, periods] of Object.entries(rawPriceData)) {
          if (Array.isArray(periods)) {
              periods.forEach(p => processPeriod(rawUuid, p));
          }
      }
  } else if (Array.isArray(rawPriceData)) {
      rawPriceData.forEach(p => {
          if (p.v_uuid) processPeriod(p.v_uuid, p);
      });
  }

  // A Code Node can output multiple branches.
  // Branch 0 = Inserts
  // Branch 1 = Updates
  return [inserts, updates];

} catch (error) {
  // If error, output it on branch 0 so we can see it
  return [[{ json: { error: error.message, stack: error.stack } }], []];
}
"""

nodes.append({
    "parameters": {
        "jsCode": js_code_split
    },
    "id": "compare-split-01",
    "name": "Compare: Insert vs Update",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [200, -1550]
})

# 4. Native Supabase Node -> INSERT (Branch 0)
nodes.append({
    "parameters": {
        "operation": "insert",
        "tableDefinition": {
            "__rls": False,
            "mode": "list",
            "value": "invenio_seasonal_prices"
        },
        "tableId": "invenio_seasonal_prices",
        "dataMode": "autoMapInputData"
    },
    "id": "native-insert-prices-01",
    "name": "Native Insert Prices",
    "type": "n8n-nodes-base.supabase",
    "typeVersion": 1,
    "position": [500, -1700]
})

# 5. Native Supabase Node -> UPDATE (Branch 1)
# Note: Update needs to map `id` as the match column natively, which is the default PK.
nodes.append({
    "parameters": {
        "operation": "update",
        "tableDefinition": {
            "__rls": False,
            "mode": "list",
            "value": "invenio_seasonal_prices"
        },
        "tableId": "invenio_seasonal_prices",
        "matchColumns": "id",
        "dataMode": "autoMapInputData"
    },
    "id": "native-update-prices-01",
    "name": "Native Update Prices",
    "type": "n8n-nodes-base.supabase",
    "typeVersion": 1,
    "position": [500, -1400]
})


# Rebuild connections
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
        "main": [[{"node": "Native Upsert Properties", "type": "main", "index": 0}]]
    },
    "Native Upsert Properties": {
        "main": [[{"node": "Get Existing Prices from Supabase", "type": "main", "index": 0}]]
    },
    "Get Existing Prices from Supabase": {
        "main": [[{"node": "Compare: Insert vs Update", "type": "main", "index": 0}]]
    },
    "Compare: Insert vs Update": {
        "main": [
            [{"node": "Native Insert Prices", "type": "main", "index": 0}], # Branch 0 = Inserts
            [{"node": "Native Update Prices", "type": "main", "index": 0}]  # Branch 1 = Updates
        ]
    }
}

data["nodes"] = nodes

with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=4)

print("Workflow rebuilt cleanly using fully Native nodes and explicit Insert/Update logic branches.")
