import urllib.request
import json
import logging

url = "https://api.inveniohomes.com/plapi/getdata/api_villa_price"
req = urllib.request.Request(url, method="POST")
req.add_header("api-key", "R$mAx1!")
req.add_header("bp_uuid", "1cb81d6f-96b8-47eb-9ef3-910739bb8d3a")

try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        price_data = data.get("price_data")
        
        print("Data type of price_data:", type(price_data))
        if isinstance(price_data, list):
            print("Length of array:", len(price_data))
            print("First 2 items:", json.dumps(price_data[:2], indent=2))
        elif isinstance(price_data, dict):
            keys = list(price_data.keys())
            print("Dict mapping by keys! Length:", len(keys))
            print("First 2 keys:", keys[:2])
            for k in keys[:2]:
                print(f"[{k}] type:", type(price_data[k]), json.dumps(price_data[k][:1] if isinstance(price_data[k], list) else price_data[k], indent=2))
        else:
            print("Unknown structure:", str(price_data)[:500])
except Exception as e:
    print("Error:", e)
