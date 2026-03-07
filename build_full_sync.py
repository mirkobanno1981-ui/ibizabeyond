import json

def build_workflow():
    workflow = {
        "name": "Ibiza Beyond - Complete Invenio Sync",
        "nodes": [],
        "connections": {},
        "settings": {
            "executionOrder": "v1",
            "callerPolicy": "workflowsFromSameOwner"
        }
    }

    # 1. Trigger
    workflow["nodes"].append({
        "parameters": {"rule": {"interval": [{}]}},
        "id": "trigger-01",
        "name": "Schedule Trigger",
        "type": "n8n-nodes-base.scheduleTrigger",
        "typeVersion": 1.3,
        "position": [-1200, 0]
    })

    # 2. Get Villas
    workflow["nodes"].append({
        "parameters": {
            "method": "POST",
            "url": "https://api.inveniohomes.com/plapi/getdata/api_villa_list",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "api-key", "value": "R$mAx1!"},
                    {"name": "bp_uuid", "value": "1cb81d6f-96b8-47eb-9ef3-910739bb8d3a"}
                ]
            },
            "options": {}
        },
        "id": "fetch-villas-01",
        "name": "Invenio - Get Villas",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.1,
        "position": [-1000, 0]
    })

    # 3. Get Prices
    workflow["nodes"].append({
        "parameters": {
            "method": "POST",
            "url": "https://api.inveniohomes.com/plapi/getdata/api_villa_price",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "api-key", "value": "R$mAx1!"},
                    {"name": "bp_uuid", "value": "1cb81d6f-96b8-47eb-9ef3-910739bb8d3a"}
                ]
            },
            "options": {}
        },
        "id": "fetch-prices-01",
        "name": "Invenio - Get Prices",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.1,
        "position": [-800, 0]
    })

    # 4. Prepare Properties
    workflow["nodes"].append({
        "parameters": {
            "jsCode": """
const villasData = $('Invenio - Get Villas').first().json;
const villas = villasData.villas || [];
const properties = [];

villas.forEach(v => {
  if (v.destination !== 'Ibiza') return;
  properties.push({
    json: {
        v_uuid: v.v_uuid,
        villa_name: v.villa_name || '',
        description: v.description || null,
        tagline: v.tagline || null,
        license: v.license || null,
        bedrooms: parseInt(v.bedrooms) || 0,
        bathrooms: parseFloat(v.bathrooms) || 0,
        sleeps: parseInt(v.sleeps) || 0,
        country: v.country || null,
        destination: v.destination || null,
        areaname: v.areaname || null,
        district: v.district || null,
        gps: v.gps || null,
        cleaning: v.cleaning || null,
        cleaning_charge: parseFloat(v.cleaning_charge) || 0,
        minimum_price: parseFloat(v.minimum_price) || null,
        maximum_price: parseFloat(v.maximum_price) || null,
        deposit: parseFloat(v.deposit) || 0,
        check_in: v.check_in || null,
        check_out: v.check_out || null,
        minimum_nights: parseInt(v.minimum_nights) || 1,
        allowed_checkin_days: v.allowed_checkin_days || null,
        ical_url: v.ical_url || null,
        v_id: parseInt(v.v_id) || null,
        features: v.features || [],
        allow_shortstays: v.allow_shortstays || null,
        direct_client_contract: v.direct_client_contract || null,
        dcc_commission: v.dcc_commission || null,
        dcc_commission_vat_included: v.dcc_commission_vat_included || null,
        connected_to_owner_ical: v.connected_to_owner_ical || null,
        last_synced_at: new Date().toISOString()
    }
  });
});
return properties;
"""
        },
        "id": "prepare-props-01",
        "name": "Prepare Properties Data",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [-600, 0]
    })

    # 5. Native Upsert Properties
    workflow["nodes"].append({
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
        "position": [-400, 0]
    })

    # --- PHOTOS BRANCH ---
    
    # 6. Get Existing Photos
    workflow["nodes"].append({
        "parameters": {
            "operation": "getAll",
            "tableDefinition": {
                "__rls": False,
                "mode": "list",
                "value": "invenio_photos"
            },
            "tableId": "invenio_photos",
            "returnAll": True
        },
        "id": "get-photos-01",
        "name": "Get Existing Photos",
        "type": "n8n-nodes-base.supabase",
        "typeVersion": 1,
        "position": [-200, -200],
        # CRITICAL: Prevent node from halting flow if table is totally empty
        "alwaysOutputData": True
    })

    # 7. Compare Photos
    workflow["nodes"].append({
        "parameters": {
            "jsCode": """
const villasNode = $('Invenio - Get Villas').first();
const existingPhotos = $input.all().map(i => i.json);

if (!villasNode) throw new Error("Could not find Villas data.");
const villas = villasNode.json.villas || [];

// Lookup map: v_uuid + url -> id
const existingMap = {};
existingPhotos.forEach(ep => {
    // Check if the node actually returned rows or just a dummy empty output
    if(ep && ep.id && ep.url) {
        const key = `${ep.v_uuid}_${ep.url}`;
        existingMap[key] = ep.id;
    }
});

const inserts = [];
const updates = [];

villas.forEach(v => {
    if (v.destination !== 'Ibiza' || !v.v_uuid) return;
    
    const photos = v.photos || [];
    const thumbnails = v.thumbnails || [];
    
    photos.forEach((url, index) => {
        if (!url) return;
        const key = `${v.v_uuid}_${url}`;
        const itemPayload = {
            v_uuid: v.v_uuid,
            url: url,
            thumbnail_url: thumbnails[index] || null,
            sort_order: index
        };
        
        if (existingMap[key]) {
            itemPayload.id = existingMap[key];
            updates.push({ json: itemPayload });
        } else {
            inserts.push({ json: itemPayload });
        }
    });
});

return [inserts, updates];
"""
        },
        "id": "compare-photos-01",
        "name": "Compare Photos",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [0, -200]
    })

    # 8. Insert Photos
    workflow["nodes"].append({
        "parameters": {
            "operation": "insert",
            "tableDefinition": {
                "__rls": False,
                "mode": "list",
                "value": "invenio_photos"
            },
            "tableId": "invenio_photos",
            "dataMode": "autoMapInputData"
        },
        "id": "insert-photos-01",
        "name": "Native Insert Photos",
        "type": "n8n-nodes-base.supabase",
        "typeVersion": 1,
        "position": [200, -300]
    })

    # 9. Update Photos
    workflow["nodes"].append({
        "parameters": {
            "operation": "update",
            "tableDefinition": {
                "__rls": False,
                "mode": "list",
                "value": "invenio_photos"
            },
            "tableId": "invenio_photos",
            "matchColumns": "id",
            "dataMode": "autoMapInputData"
        },
        "id": "update-photos-01",
        "name": "Native Update Photos",
        "type": "n8n-nodes-base.supabase",
        "typeVersion": 1,
        "position": [200, -100]
    })

    # --- PRICES BRANCH ---

    # 10. Get Existing Prices
    workflow["nodes"].append({
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
        "id": "get-prices-01",
        "name": "Get Existing Prices",
        "type": "n8n-nodes-base.supabase",
        "typeVersion": 1,
        "position": [-200, 200],
        # CRITICAL: Prevent node from halting flow if table is totally empty
        "alwaysOutputData": True
    })

    # 11. Compare Prices
    workflow["nodes"].append({
        "parameters": {
            "jsCode": """
const villasNode = $('Invenio - Get Villas').first();
const invenioPricesNode = $('Invenio - Get Prices').first();
const existingPrices = $input.all().map(i => i.json);

if (!villasNode) throw new Error("Could not find Villas data.");
if (!invenioPricesNode) throw new Error("Could not find Invenio Prices data.");

const villas = villasNode.json.villas || [];
const rawPriceData = invenioPricesNode.json.price_data || {};

const existingMap = {};
existingPrices.forEach(ep => {
    // Check if the node actually returned rows or just a dummy empty output
    if(ep && ep.id && ep.start_date) {
        const safeUuid = String(ep.v_uuid).trim().toLowerCase();
        const safeDate = String(ep.start_date).trim();
        const key = `${safeUuid}_${safeDate}`;
        existingMap[key] = ep.id;
    }
});

const ibizaUuids = {};
villas.forEach(v => {
    if (v.destination === 'Ibiza' && v.v_uuid) {
        ibizaUuids[String(v.v_uuid).trim().toLowerCase()] = true;
    }
});

const inserts = [];
const updates = [];

function processPeriod(rawUuid, p) {
    if (!p || !p.start_date || !p.end_date) return;
    
    const safeUuid = String(rawUuid).trim().toLowerCase();
    if (!ibizaUuids[safeUuid]) return;
    
    const safeDate = String(p.start_date).trim();
    const key = `${safeUuid}_${safeDate}`;

    const itemPayload = {
        v_uuid: rawUuid,
        start_date: p.start_date,
        end_date: p.end_date,
        amount: parseFloat(p.amount) || 0,
        minimum_nights: parseInt(p.minimum_nights) || 1,
        allowed_checkin_days: p.allowed_checkin_days || null
    };

    if (existingMap[key]) {
        itemPayload.id = existingMap[key];
        updates.push({ json: itemPayload });
    } else {
        inserts.push({ json: itemPayload });
    }
}

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

return [inserts, updates];
"""
        },
        "id": "compare-prices-01",
        "name": "Compare Prices",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [0, 200]
    })

    # 12. Insert Prices
    workflow["nodes"].append({
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
        "id": "insert-prices-01",
        "name": "Native Insert Prices",
        "type": "n8n-nodes-base.supabase",
        "typeVersion": 1,
        "position": [200, 100]
    })

    # 13. Update Prices
    workflow["nodes"].append({
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
        "id": "update-prices-01",
        "name": "Native Update Prices",
        "type": "n8n-nodes-base.supabase",
        "typeVersion": 1,
        "position": [200, 300]
    })


    # Build connections
    workflow["connections"] = {
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
            "main": [
                [
                    {"node": "Get Existing Photos", "type": "main", "index": 0},
                    {"node": "Get Existing Prices", "type": "main", "index": 0}
                ]
            ]
        },
        "Get Existing Photos": {
            "main": [[{"node": "Compare Photos", "type": "main", "index": 0}]]
        },
        "Compare Photos": {
            "main": [
                [{"node": "Native Insert Photos", "type": "main", "index": 0}], # Branch 0
                [{"node": "Native Update Photos", "type": "main", "index": 0}]  # Branch 1
            ]
        },
        "Get Existing Prices": {
            "main": [[{"node": "Compare Prices", "type": "main", "index": 0}]]
        },
        "Compare Prices": {
            "main": [
                [{"node": "Native Insert Prices", "type": "main", "index": 0}], # Branch 0
                [{"node": "Native Update Prices", "type": "main", "index": 0}]  # Branch 1
            ]
        }
    }

    return workflow

if __name__ == "__main__":
    workflow = build_workflow()
    with open("c:/Users/mirko/Documents/Ibiza Beyond/invenio_supabase_sync.json", "w", encoding="utf-8") as f:
        json.dump(workflow, f, indent=4)
    print("Workflow successfully rebuilt from scratch, including empty-table safety net!")
