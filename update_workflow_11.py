import json

filepath = "c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_sync.json"

with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

nodes_dict = {n["name"]: n for n in data["nodes"]}

# Based on the python script output, `price_data` IS indeed a Dict/Object mapped by UUID.
# The user's earlier error sample "sample_data_keys: 0, 1, 2, 3, 4" was actually from
# my fallback code triggering because it failed `ibizaUuids.has(uuid)`.
# WHY did `ibizaUuids.has(uuid)` fail for everything?
# Because `ibizaUuids` was created from `villasData.villas`.
# What if `$('Invenio - Get Villas').first().json.villas` was an array of something else?
# Let's check `v_uuid` capitalization or if `villasData` is structured differently.
# But "Prepare Properties Data" works perfectly with:
# `villas.forEach(v => { if (v.destination !== 'Ibiza') return; ... v_uuid: v.v_uuid ... })`
# So `v.v_uuid` definitely exists and represents the UUID.
# Maybe the `uuid` from `price_data` keys is slightly different (e.g., whitespace)?
# Or maybe the code is perfectly fine but I should just remove the strict Ibiza filtering
# if we only fetch Ibiza villas anyway? Or check it safely.
# To be absolutely sure, let's log everything that is being inserted.

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
          // Store stripped lowercased uuid for safe matching
          ibizaUuids[String(v.v_uuid).trim().toLowerCase()] = true;
      }
  });
  
  const chunks = [];
  let currentChunk = [];
  let totalProcessed = 0;

  // We know it's an object mapping keys to arrays of periods.
  if (typeof price_data === 'object' && !Array.isArray(price_data)) {
    for (const [rawUuid, periods] of Object.entries(price_data)) {
      const safeUuid = String(rawUuid).trim().toLowerCase();
      
      // If the property is in Ibiza and API actually gave us standard periods
      if (ibizaUuids[safeUuid] && Array.isArray(periods)) {
        periods.forEach(p => {
          if (p && p.start_date && p.end_date) {
            currentChunk.push({
              v_uuid: rawUuid,
              start_date: p.start_date,
              end_date: p.end_date,
              amount: parseFloat(p.amount) || 0,
              currency_code: p.currency_code || null,
              unit: p.unit || null,
              minimum_nights: parseInt(p.minimum_nights) || 1,
              allowed_checkin_days: p.allowed_checkin_days || null,
              last_synced_at: new Date().toISOString()
            });
            totalProcessed++;
            
            if (currentChunk.length >= 500) {
               chunks.push({ json: { prices: currentChunk } });
               currentChunk = [];
            }
          }
        });
      }
    }
  } else if (Array.isArray(price_data)) {
      // Very weird edge case if Invenio changed their API return structure
      price_data.forEach(p => {
         if (p && p.v_uuid) {
            const safeUuid = String(p.v_uuid).trim().toLowerCase();
            if (ibizaUuids[safeUuid] && p.start_date && p.end_date) {
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
                totalProcessed++;
                
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
     return [ { json: { error: "No prices processed for Ibiza. Total items in price_data: " + Object.keys(price_data).length } } ];
  }
  
  return chunks;
} catch (error) {
  return [{ json: { error: error.message, stack: error.stack } }];
}
"""

with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=4)

print("Prepare Prices Data syntax modified with lowercase robust UUID matching.")
