import json

filepath = "c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_sync.json"

with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

nodes_dict = {n["name"]: n for n in data["nodes"]}

# Ah! The user's output `sample_data_keys: "0, 1, 2, 3, 4"` means that `price_data` is an Array of Objects!
# Previously the script assumed it was an Object dictionary keyed by v_uuid: `{ 'uuid1': [...], 'uuid2': [...] }`.
# But Invenio actually returns `price_data: [ { v_uuid: "xxx", start_date: "...", ... }, { v_uuid: "yyy", ... } ]`.
# Let's fix the iteration inside Prepare Prices Data.

nodes_dict["Prepare Prices Data"]["parameters"]["jsCode"] = """
try {
  const villasNode = $('Invenio - Get Villas').first();
  const pricesNode = $('Invenio - Get Prices').first();
  
  const villasData = villasNode ? villasNode.json : {};
  const pricesData = pricesNode ? pricesNode.json : {};

  if(!villasNode) throw new Error("Could not find 'Invenio - Get Villas' node data in memory.");
  if(!pricesNode) throw new Error("Could not find 'Invenio - Get Prices' node data in memory.");

  const villas = villasData.villas || [];
  const price_data = pricesData.price_data;
  
  if (!price_data) {
    throw new Error("No price_data found inside Invenio - Get Prices response.");
  }

  const ibizaUuids = new Set(villas.filter(v => v.destination === 'Ibiza').map(v => v.v_uuid));
  
  const chunks = [];
  let currentChunk = [];

  // Since sample_data_keys was '0, 1, 2', it means price_data is definitely an Array of Objects.
  if (Array.isArray(price_data)) {
    price_data.forEach(p => {
       // Does p have v_uuid and is it in Ibiza?
       if (p && p.v_uuid && ibizaUuids.has(p.v_uuid) && p.start_date && p.end_date) {
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
    // Fallback if it ever changes back to Dictionary mapping
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
  
  if (currentChunk.length > 0) {
      chunks.push({ json: { prices: currentChunk } });
  }
  
  if (chunks.length === 0) {
     return [ { json: { error: "No prices found matching Ibiza UUIDs", sample_type: Array.isArray(price_data) ? 'Array' : 'Object', data_length: price_data.length } } ];
  }
  
  return chunks;
} catch (error) {
  return [{ json: { error: error.message, stack: error.stack } }];
}
"""

with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=4)

print("Updated Prepare Prices Data to natively parse Arrays of objects.")
