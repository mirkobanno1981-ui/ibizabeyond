import json

filepath = "c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_sync.json"

with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

nodes_dict = {n["name"]: n for n in data["nodes"]}

# The JSON parsing error in "Upsert Prices to Supabase" is because 
# the fallback ternary operator returns '' (empty string), which is not valid JSON.
# It should return '[]' (empty array string).

upsert_prices_node = nodes_dict["Upsert Prices to Supabase"]
upsert_prices_node["parameters"]["jsonBody"] = "={{ $json.prices ? JSON.stringify($json.prices) : '[]' }}"


with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=4)

print("Fixed Upsert Prices to Supabase jsonBody parameter.")
