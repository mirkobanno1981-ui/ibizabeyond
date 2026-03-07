import json

filepath = "c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_sync.json"

with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

for node in data["nodes"]:
    if node["type"] == "n8n-nodes-base.supabase" and node["name"] == "Upsert Prices to Supabase":
        if "columns" in node["parameters"]:
            del node["parameters"]["columns"]
        # In n8n v1+, you might need dataMode
        node["parameters"]["dataMode"] = "autoMapInputData"

with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=4)

print("Removed columns mapping and explicitly set dataMode to autoMapInputData.")
