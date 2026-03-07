import json

json_string = """
{
    "name": "Ibiza Beyond - Seasonal Prices Sync (Delete & Insert)",
    "nodes": [
        {
            "parameters": {
                "rule": {
                    "interval": [{}]
                }
            },
            "id": "trigger-price-sync",
            "name": "Schedule Trigger",
            "type": "n8n-nodes-base.scheduleTrigger",
            "typeVersion": 1.3,
            "position": [-200, 0]
        },
        {
            "parameters": {
                "method": "POST",
                "url": "https://api.inveniohomes.com/plapi/getdata/api_villa_list",
                "sendHeaders": true,
                "headerParameters": {
                    "parameters": [
                        { "name": "api-key", "value": "R$mAx1!" },
                        { "name": "bp_uuid", "value": "1cb81d6f-96b8-47eb-9ef3-910739bb8d3a" }
                    ]
                },
                "options": {}
            },
            "id": "fetch-villas",
            "name": "Invenio - Get Villas",
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 4.1,
            "position": [0, 0]
        },
        {
            "parameters": {
                "method": "POST",
                "url": "https://api.inveniohomes.com/plapi/getdata/api_villa_price",
                "sendHeaders": true,
                "headerParameters": {
                    "parameters": [
                        { "name": "api-key", "value": "R$mAx1!" },
                        { "name": "bp_uuid", "value": "1cb81d6f-96b8-47eb-9ef3-910739bb8d3a" }
                    ]
                },
                "options": {}
            },
            "id": "fetch-prices",
            "name": "Invenio - Get Prices",
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 4.1,
            "position": [200, 0]
        },
        {
            "parameters": {
                "jsCode": "const villasNode = $('Invenio - Get Villas').first();\\nconst invenioPricesNode = $('Invenio - Get Prices').first();\\n\\nif (!villasNode) throw new Error(\\\"Could not find Villas data.\\\");\\nif (!invenioPricesNode) throw new Error(\\\"Could not find Invenio Prices data.\\\");\\n\\nconst villas = villasNode.json.villas || [];\\nlet rawPriceData = invenioPricesNode.json.price_data || [];\\n\\n// 1. Array di UUID Ibiza validi\\nconst ibizaUuids = {};\\nvillas.forEach(v => {\\n    if (v.destination === 'Ibiza' && v.v_uuid) {\\n        ibizaUuids[String(v.v_uuid).trim().toLowerCase()] = true;\\n    }\\n});\\n\\n// 2. Raggruppa prezzi per ogni villa\\nlet itemsToProcess = [];\\n\\nlet priceEntries = [];\\nif (Array.isArray(rawPriceData)) {\\n    priceEntries = rawPriceData;\\n} else if (typeof rawPriceData === 'object') {\\n    for (const [key, value] of Object.entries(rawPriceData)) {\\n        let obj = {};\\n        obj[key] = value;\\n        priceEntries.push(obj);\\n    }\\n}\\n\\nfor (const item of priceEntries) {\\n    const v_uuid = Object.keys(item)[0];\\n    if (!v_uuid) continue;\\n    \\n    const safeUuid = String(v_uuid).trim().toLowerCase();\\n    if (!ibizaUuids[safeUuid]) continue;\\n    \\n    const periods = item[v_uuid];\\n    if (!periods || !Array.isArray(periods)) continue;\\n    \\n    let formattedPeriods = periods.map(p => ({\\n        v_uuid: v_uuid,\\n        start_date: p.start_date,\\n        end_date: p.end_date,\\n        amount: parseFloat(p.amount) || 0,\\n        minimum_nights: parseInt(p.minimum_nights) || 1,\\n        allowed_checkin_days: p[\\\" allowed_checkin_days \\\"] || p.allowed_checkin_days || null\\n    }));\\n    \\n    if (formattedPeriods.length > 0) {\\n        itemsToProcess.push({\\n            v_uuid: v_uuid,\\n            prices: formattedPeriods\\n        });\\n    }\\n}\\n\\nreturn itemsToProcess.map(item => ({ json: item }));"
            },
            "id": "format-prices",
            "name": "Group Prices By Villa",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [400, 0]
        },
        {
            "parameters": {
                "batchSize": 1,
                "options": {}
            },
            "id": "split-in-batches",
            "name": "Loop Sub-workflow",
            "type": "n8n-nodes-base.splitInBatches",
            "typeVersion": 2,
            "position": [600, 0]
        },
        {
            "parameters": {
                "operation": "delete",
                "tableDefinition": {
                    "__rls": false,
                    "mode": "list",
                    "value": "invenio_seasonal_prices"
                },
                "tableId": "invenio_seasonal_prices",
                "matchColumns": "v_uuid",
                "dataMode": "autoMapInputData"
            },
            "id": "supabase-delete",
            "name": "Delete Old Sync",
            "type": "n8n-nodes-base.supabase",
            "typeVersion": 1,
            "position": [800, 0]
        },
        {
            "parameters": {
                "jsCode": "const loopItem = $('Loop Sub-workflow').item;\\nlet prices = [];\\nif (loopItem && loopItem.json && loopItem.json.prices) {\\n    prices = loopItem.json.prices;\\n}\\nif (prices.length === 0) return [];\\nreturn prices.map(p => ({ json: p }));"
            },
            "id": "extract-prices",
            "name": "Extract Array",
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [1000, 0]
        },
        {
            "parameters": {
                "operation": "insert",
                "tableDefinition": {
                    "__rls": false,
                    "mode": "list",
                    "value": "invenio_seasonal_prices"
                },
                "tableId": "invenio_seasonal_prices",
                "dataMode": "autoMapInputData"
            },
            "id": "supabase-insert",
            "name": "Insert Fresh Sync",
            "type": "n8n-nodes-base.supabase",
            "typeVersion": 1,
            "position": [1200, 0]
        }
    ],
    "connections": {
        "Schedule Trigger": {
            "main": [ [ { "node": "Invenio - Get Villas", "type": "main", "index": 0 } ] ]
        },
        "Invenio - Get Villas": {
            "main": [ [ { "node": "Invenio - Get Prices", "type": "main", "index": 0 } ] ]
        },
        "Invenio - Get Prices": {
            "main": [ [ { "node": "Group Prices By Villa", "type": "main", "index": 0 } ] ]
        },
        "Group Prices By Villa": {
            "main": [ [ { "node": "Loop Sub-workflow", "type": "main", "index": 0 } ] ]
        },
        "Loop Sub-workflow": {
            "main": [ [ { "node": "Delete Old Sync", "type": "main", "index": 0 } ] ]
        },
        "Delete Old Sync": {
            "main": [ [ { "node": "Extract Array", "type": "main", "index": 0 } ] ]
        },
        "Extract Array": {
            "main": [ [ { "node": "Insert Fresh Sync", "type": "main", "index": 0 } ] ]
        },
        "Insert Fresh Sync": {
            "main": [ [ { "node": "Loop Sub-workflow", "type": "main", "index": 0 } ] ]
        }
    },
    "settings": {
        "executionOrder": "v1",
        "callerPolicy": "workflowsFromSameOwner"
    }
}
"""

workflow = json.loads(json_string)

with open("c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_price_sync_native.json", "w", encoding="utf-8") as f:
    json.dump(workflow, f, indent=4)

