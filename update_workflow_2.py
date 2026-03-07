import json
import os

filepath = "c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_sync.json"

with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

nodes_dict = {n["name"]: n for n in data["nodes"]}

# 1. Update Code node to return two separate items if needed, or we just split the prices.
# Supabase limits upsert payload size. Prices array could be massive (100 villas * 50 periods = 5000 items).
# The preferred n8n way is to isolate the prices array into its own items pipeline.

# Let's add an Item Lists Node to split the prices array.
item_lists_node = {
    "parameters": {
        "fieldToSplitOut": "prices",
        "options": {}
    },
    "type": "n8n-nodes-base.itemLists",
    "typeVersion": 3,
    "position": [
        -100,
        -1350
    ],
    "id": "split-prices-01",
    "name": "Split Prices"
}

# Add a loop (Split In Batches) to send them in chunks of 1000 to avoid payload limits
split_batches_node = {
    "parameters": {
        "batchSize": 500,
        "options": {}
    },
    "type": "n8n-nodes-base.splitInBatches",
    "typeVersion": 3,
    "position": [
        150,
        -1350
    ],
    "id": "loop-prices-01",
    "name": "Loop Prices"
}


# 2. Modify Upsert Prices to Upsert the Loop output 
upsert_prices_node = nodes_dict["Upsert Prices to Supabase"]
upsert_prices_node["position"] = [400, -1350]
# Use the direct item output representing an array of up to 500 objects, not the entire array which was overflowing.
# Actually, the ItemLists splits the array into single items.
# So $json represents a single price object.
# To put them back into an array for the bulk Supabase request, we can just bulk-send the Loop output.
# Since we are sending batches, `$('Loop Prices').all().map(i => i.json)` gets the chunk.
upsert_prices_node["parameters"]["jsonBody"] = "={{ JSON.stringify($input.all().map(i => i.json)) }}"


# Fix connections
data["nodes"] = [
    nodes_dict["Schedule Trigger"],
    nodes_dict["Invenio - Get Villas"],
    nodes_dict["Invenio - Get Prices"],
    nodes_dict["Prepare Supabase Data"],
    nodes_dict["Upsert Properties to Supabase"],
    item_lists_node,
    split_batches_node,
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
            [{"node": "Split Prices", "type": "main", "index": 0}]
        ]
    },
    "Split Prices": {
        "main": [
            [{"node": "Loop Prices", "type": "main", "index": 0}]
        ]
    },
    "Loop Prices": {
        "main": [
            [{"node": "Upsert Prices to Supabase", "type": "main", "index": 0}]
        ]
    },
    "Upsert Prices to Supabase": {
        "main": [
            [{"node": "Loop Prices", "type": "main", "index": 0}]
        ]
    }
}

with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=4)

print("Workflow configured with batching.")
