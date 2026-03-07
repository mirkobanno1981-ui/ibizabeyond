import json

filepath = "c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_sync.json"

with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

nodes_dict = {n["name"]: n for n in data["nodes"]}

# In n8n v1+, returning an array of raw objects from a Code node is generally supported,
# but sometimes strictly requiring `{ json: { ... } }` or just returning the array directly depends on the n8n version.
# Wait, the node says: "return prices;"
# And the `prices` array contains: `{ json: { v_uuid: ... } }`
# BUT wait! If we do `const prices = []` and `prices.push({ json: ... })`, 
# and then `return prices;`, this is generally correct for n8n.
# Let's double check if my `$('Invenio - Get Prices').first().json` is failing because of branching?
# Ah! In the parallel branch:
# "Prepare Properties Data" and "Prepare Prices Data" BOTH run after "Invenio - Get Prices".
# "Invenio - Get Villas" data is accessed via `$()`.
# Wait, in the node "Prepare Prices Data", I have:
# const villasData = $('Invenio - Get Villas').first().json;
# const pricesData = $('Invenio - Get Prices').first().json;
# 
# Wait, n8n Code Node for multiple items should ideally return just the items.
# What if `$('Invenio - Get Villas').first()` is undefined for some reason in this parallel node?
# Actually, the error is probably because the n8n node is configured as "Run Once for All Items" (which is default for Code),
# BUT `$('Invenio - Get Villas').first()` might be failing if it's out of context.
# Let's change the code to use `$items("Invenio - Get Villas")[0].json` which is more standard in n8n v1 for cross-node referencing,
# OR we pass the data down explicitly.
# 
# But wait, looking at `prepare-data-01`, it worked perfectly before.
# Let's adjust the prices array building to be extremely safe against nulls and type errors.
# Also, let's wrap it in a try-catch to see if we can at least return the error message as an item if it fails!

nodes_dict["Prepare Prices Data"]["parameters"]["jsCode"] = """
try {
  const villasNode = $('Invenio - Get Villas').first();
  const pricesNode = $('Invenio - Get Prices').first();
  
  const villasData = villasNode ? villasNode.json : {};
  const pricesData = pricesNode ? pricesNode.json : {};

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
              minimum_nights: parseInt(p.minimum_nights) || 1,
              allowed_checkin_days: p.allowed_checkin_days || null,
              last_synced_at: new Date().toISOString()
            }
          });
        }
      });
    }
  }
  
  if (prices.length === 0) {
     return [{ json: { message: "No prices found or parse error" } }];
  }
  
  return prices;
} catch (error) {
  return [{ json: { error: error.message, stack: error.stack } }];
}
"""

with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=4)

print("Prepare Prices Data syntax modified with try-catch and safer fallback.")
