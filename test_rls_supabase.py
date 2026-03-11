import os
import json
import urllib.request
import urllib.error

# Chiavi dal .env.local
SUPABASE_URL = "https://nqnwmotrjlbqdnrwcyfz.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xbndtb3RyamxicWRucndjeWZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDA4NTIsImV4cCI6MjA4ODAxNjg1Mn0.ku8cl9x-2d_PWI63MTSyOFELJaNIVLUiqFFqDU3p3CM"

url = f"{SUPABASE_URL}/rest/v1/invenio_properties?select=*&limit=1"
headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        if len(data) > 0:
            print("Colonne Trovate nella Tabella invenio_properties:")
            print(", ".join(data[0].keys()))
        else:
            print("Tabella trovata ma è vuota.")
except urllib.error.HTTPError as e:
    print(f"❌ FALLITO! Status Code: {e.code}")
    print(f"Motivo RLS Supabase: {e.read().decode()}")
except Exception as e:
    print(f"❌ ERRORE DI RETE: {str(e)}")
