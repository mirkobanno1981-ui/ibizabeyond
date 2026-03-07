import urllib.request
import json

headers = {
    "api-key": "R$mAx1!",
    "bp_uuid": "1cb81d6f-96b8-47eb-9ef3-910739bb8d3a"
}

print("Fetching villas from Invenio...")
req = urllib.request.Request("https://api.inveniohomes.com/plapi/getdata/api_villa_list", headers=headers, method="POST")

try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        
    with open('invenio_raw.json', 'w') as f:
        json.dump(data, f, indent=2)
    print("Saved raw data to invenio_raw.json")
    
    if isinstance(data, dict):
        # find the list
        villas = data.get('data') or data.get('villas') or data.get('result') or list(data.values())[1]  if len(data.values())>1 and isinstance(list(data.values())[1], list) else []
    else:
        villas = data
        
    print(f"Total villas received: {len(villas)}")

    ibiza_villas = []
    for v in villas:
        if isinstance(v, dict) and v.get('destination') == 'Ibiza':
            ibiza_villas.append({
                'name': v.get('villa_name'),
                'uuid': v.get('v_uuid'),
                'min_nights': v.get('minimum_nights'),
                'check_in': v.get('check_in'),
                'check_out': v.get('check_out'),
                'allowed_checkin_days': v.get('allowed_checkin_days'),
                'deposit': v.get('deposit')
            })

    with open('ibiza_villas.json', 'w', encoding='utf-8') as f:
        json.dump(ibiza_villas, f, indent=2, ensure_ascii=False)

    print(f"Saved {len(ibiza_villas)} Ibiza villas to ibiza_villas.json")
except Exception as e:
    print(f"Error: {e}")
