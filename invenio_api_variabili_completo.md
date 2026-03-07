# 📘 Invenio Homes — Data Export API V2.9.2
## Documentazione Completa di Tutte le Variabili e Campi

> Documento generato automaticamente dal notebook NotebookLM **"Invenio Homes: Documentazione Tecnica API V2.9.2"** — fonte: `Data Export API V2.9.2.pdf` e `WpRentals API Postman Docs`.

---

## 🔐 Autenticazione

Tutte le richieste API devono includere **due credenziali nell'header HTTP**:

| Header | Tipo | Descrizione |
|--------|------|-------------|
| `api-key` | `string` | Token dell'API fornito da Invenio |
| `bp_uuid` | `string` | Identificativo UUID del Business Partner |

**URL di base produzione:** `https://api.inveniohomes.com`

> [!IMPORTANT]
> L'ambiente di test è stato **dismesso dal 7 febbraio 2022**. Utilizzare solo l'URL di produzione.

---

## 📡 Endpoint 1 — Villas (Lista completa ville)

| Proprietà | Valore |
|-----------|--------|
| **Metodo** | `POST` |
| **URL** | `https://api.inveniohomes.com/plapi/getdata/api_villa_list` |
| **Payload** | ❌ Nessuno richiesto |
| **Risposta** | Array JSON di oggetti `Villa` |

### Campi di Risposta (Oggetto `Villa`)

| # | Campo | Tipo | Descrizione |
|---|-------|------|-------------|
| 1 | `villa_name` | `string` | Nome univoco della villa |
| 2 | `v_id` | `number` | ID numerico della villa ⚠️ *sarà deprecato in futuro* |
| 3 | `v_uuid` | `string` | Identificativo UUID univoco della villa (campo principale) |
| 4 | `deposit` | `string/number` | Importo del deposito cauzionale |
| 5 | `minimum_nights` | `number` | Numero minimo di notti per prenotazione |
| 6 | `allow_shortstays` | `string` | Sovrapprezzo soggiorni brevi abilitato: `"1"` = sì, `"0"` = no |
| 7 | `direct_client_contract` | `string` | Contratto diretto col cliente: `"1"` = sì, `"0"` = no |
| 8 | `dcc_commission` | `string` | Commissione % fissa per DCC (es. `"10"` = 10%). Vuoto `""` = non applicabile |
| 9 | `dcc_commission_vat_included` | `string` | IVA inclusa nella commissione DCC: `"1"` = inclusa, `"0"` = esclusa, `""` = N/A |
| 10 | `license` | `string` | Licenza commerciale di affitto |
| 11 | `destination` | `string` | Destinazione (es. "Ibiza", "Mykonos") |
| 12 | `district` | `string` | Distretto (es. "South East") |
| 13 | `country` | `string` | Nazione |
| 14 | `areaname` | `string` | Nome della zona locale |
| 15 | `bathrooms` | `string` | Numero di bagni |
| 16 | `bedrooms` | `string` | Numero di camere da letto |
| 17 | `sleeps` | `string` | Numero di posti letto |
| 18 | `gps` | `string` | Coordinate GPS (precisione ~1,6 km) |
| 19 | `cleaning` | `string` | Tipo di pulizia inclusa |
| 20 | `cleaning_charge` | `number` | Costo delle pulizie (€) |
| 21 | `check_in` | `string` | Orario prima del quale NON è possibile fare check-in |
| 22 | `check_out` | `string` | Orario limite per il check-out |
| 23 | `allowed_checkin_days` | `string` | Giorni consentiti per il check-in (es. "Saturday to Saturday") |
| 24 | `photos` | `array/string` | URL delle foto della villa |
| 25 | `thumbnails` | `array` | URL delle miniature corrispondenti alle foto |
| 26 | `minimum_price` | `number` | Prezzo settimanale minimo futuro ("a partire da") |
| 27 | `maximum_price` | `number` | Prezzo settimanale massimo futuro |
| 28 | `features` | `string/array` | Lista servizi/comfort (amenities) della villa |
| 29 | `description` | `string` | Descrizione completa della villa |
| 30 | `tagline` | `string` | Slogan/titolo breve della villa |
| 31 | `ical_url` | `string` | URL per download file `.ics` con date prenotate |
| 32 | `connected_to_owner_ical` | `string` | Collegamento calendario iCal proprietario: `"1"` = sì, `"0"` = no |

---

## 📡 Endpoint 2 — Availability (Disponibilità + Prezzo)

| Proprietà | Valore |
|-----------|--------|
| **Metodo** | `POST` |
| **URL** | `https://api.inveniohomes.com/plapi/getdata/api_villa_availability` |
| **Payload** | ✅ Richiesto (formato key-value, chiave `param`) |
| **Risposta** | Array JSON di oggetti `PricedVilla` |

### Parametri di Input (Payload)

Il payload deve essere inviato come coppia chiave-valore con **chiave `param`** e **valore** un array JSON:

| # | Campo | Tipo | Obbligatorio | Descrizione |
|---|-------|------|:---:|-------------|
| 1 | `from_date` | `string` | ✅ | Data inizio (formato `YYYY-MM-DD`) |
| 2 | `to_date` | `string` | ✅ | Data fine (formato `YYYY-MM-DD`) |
| 3 | `from_price` | `integer` | ❌ | Prezzo minimo (es. `5000`) |
| 4 | `to_price` | `integer` | ❌ | Prezzo massimo (es. `20000`) |
| 5 | `min_bedrooms` | `integer` | ❌ | Numero minimo camere da letto |
| 6 | `max_bedrooms` | `integer` | ❌ | Numero massimo camere da letto |
| 7 | `destination_name` | `string` | ❌ | Nome destinazione (es. `"Ibiza"`) |
| 8 | `search_term` | `string` | ❌ | Ricerca per nome villa (es. `"Can Idle"`) |
| 9 | `v_uuid` | `string` | ❌ | UUID specifico di una villa |

> [!WARNING]
> `v_uuid` e `search_term` sono **mutualmente esclusivi**: usare uno O l'altro, mai entrambi.

### Campi di Risposta (Oggetto `PricedVilla`)

Contiene **tutti i 32 campi dell'oggetto `Villa`** (vedi Endpoint 1) **più** il campo aggiuntivo:

| # | Campo | Tipo | Descrizione |
|---|-------|------|-------------|
| 33 | `price` | `number` | Prezzo per l'intervallo di date selezionato. Può essere `0` se non specificato `from_date`/`to_date` o se la villa ha "Prezzo su richiesta". **Non include markup**. Include eventuali sovrapprezzi short stay. |

---

## 📡 Endpoint 3 — Price (Listino Prezzi Completo)

| Proprietà | Valore |
|-----------|--------|
| **Metodo** | `POST` |
| **URL** | `https://api.inveniohomes.com/plapi/getdata/api_villa_price` |
| **Payload** | ❌ Nessuno richiesto |
| **Risposta** | Oggetto JSON `Price` |

### Campi di Risposta (Oggetto `Price`)

| # | Campo | Tipo | Descrizione |
|---|-------|------|-------------|
| 1 | `success` | `string` | Esito della richiesta (es. `"true"`) |
| 2 | `price_data` | `object` | Contenitore JSON di tutti i prezzi per villa |

### Struttura interna di `price_data`

Ogni villa è identificata dalla chiave `v_uuid`. Il valore può essere:

| Caso | Valore | Significato |
|------|--------|-------------|
| **Prezzi disponibili** | Array di oggetti prezzo | Lista periodi con prezzi |
| **Nessun prezzo** | `null` | Prezzo non ancora definito |
| **Su richiesta** | `[{"message":"Price on request"}]` | Villa disponibile solo a prezzo su richiesta |

### Campi di ogni oggetto prezzo all'interno di `price_data[v_uuid]`

| # | Campo | Tipo | Descrizione |
|---|-------|------|-------------|
| 1 | `start_date` | `string` | Data inizio periodo di prezzo |
| 2 | `end_date` | `string` | Data fine periodo di prezzo |
| 3 | `amount` | `number` | Importo del prezzo (senza markup) |
| 4 | `currency_code` | `string` | Valuta (es. `"EUR"`) |
| 5 | `unit` | `string` | Unità di misura (es. `"Night"` = prezzo a notte) |
| 6 | `minimum_nights` | `number` | Notti minime per questo periodo. **Ha priorità** sul campo `minimum_nights` dell'Endpoint Villas |
| 7 | `allowed_checkin_days` | `string` | Giorni di check-in consentiti in questo periodo. **Ha priorità** sul campo omonimo dell'Endpoint Villas |

---

## ⚙️ Regole di Business Logic

### 1. Commissioni e Markup (Direct Client Contract — DCC)

| Regola | Dettaglio |
|--------|-----------|
| I prezzi API **non includono markup** | L'importo `amount` e `price` sono sempre netti |
| Se `direct_client_contract = "1"` | ⛔ **Vietato applicare markup supplementari** |
| `dcc_commission` | Percentuale di commissione fissa (es. `"10"` = 10%) |
| `dcc_commission_vat_included = "1"` | La commissione include già l'IVA |
| `dcc_commission_vat_included = "0"` | La commissione è IVA esclusa |

### 2. Logica Short Stay (Soggiorni Brevi)

Attivata solo se `allow_shortstays = "1"`.

**Filtro di scarto:** Se la ricerca è ≤ 6 giorni e il budget risultante < €3.500, la villa **non appare** nei risultati.

**Supplementi percentuali:**

| Durata soggiorno | Supplemento % |
|:---:|:---:|
| 3 giorni | **+50%** |
| 4 giorni | **+25%** |
| 5 giorni | **+20%** |
| 6 giorni | **+10%** |

> ➕ Si aggiunge sempre un **supplemento fisso di €200** per soggiorni brevi.

### 3. Regole di Disponibilità (Filtri Sequenziali)

#### Gap Detection (Buchi di calendario)
Una villa appare disponibile in un "buco" tra due prenotazioni se:
- La ricerca ha durata ≥ 3 notti (minimum gap nights)
- La durata < notti minime del periodo (`period min nights`)
- Il gap effettivo soddisfa gli stessi requisiti

#### Min Nights (Notti Minime)
I risultati escludono ville che non soddisfano il limite `minimum_nights` del periodo. **Eccezioni:**
- Ricerca a ridosso della partenza (≤7 giorni prima del check-in) con ≥3 notti
- Prenotazioni lunghe (≥28 giorni)
- Giorni ricercati ≥ durata massima delle notti minime del periodo

#### Regole di Check-in
Restrizioni sui giorni (es. solo sabato-sabato). Aggirabili se:
- Le date coprono esattamente il doppio delle notti minime
- Il gap di calendario soddisfa la Gap Detection

---

## 📊 Riepilogo Rapido — Tutti i Campi per Endpoint

```
┌─────────────────────────┬───────────┬──────────────┬───────────┐
│ Campo                   │ 1. Villas │ 2. Availab.  │ 3. Price  │
├─────────────────────────┼───────────┼──────────────┼───────────┤
│ villa_name              │    ✅     │     ✅       │           │
│ v_id                    │    ✅     │     ✅       │           │
│ v_uuid                  │    ✅     │     ✅       │  (chiave) │
│ deposit                 │    ✅     │     ✅       │           │
│ minimum_nights          │    ✅     │     ✅       │    ✅     │
│ allow_shortstays        │    ✅     │     ✅       │           │
│ direct_client_contract  │    ✅     │     ✅       │           │
│ dcc_commission          │    ✅     │     ✅       │           │
│ dcc_commission_vat_incl │    ✅     │     ✅       │           │
│ license                 │    ✅     │     ✅       │           │
│ destination             │    ✅     │     ✅       │           │
│ district                │    ✅     │     ✅       │           │
│ country                 │    ✅     │     ✅       │           │
│ areaname                │    ✅     │     ✅       │           │
│ bathrooms               │    ✅     │     ✅       │           │
│ bedrooms                │    ✅     │     ✅       │           │
│ sleeps                  │    ✅     │     ✅       │           │
│ gps                     │    ✅     │     ✅       │           │
│ cleaning                │    ✅     │     ✅       │           │
│ cleaning_charge         │    ✅     │     ✅       │           │
│ check_in                │    ✅     │     ✅       │           │
│ check_out               │    ✅     │     ✅       │           │
│ allowed_checkin_days    │    ✅     │     ✅       │    ✅     │
│ photos                  │    ✅     │     ✅       │           │
│ thumbnails              │    ✅     │     ✅       │           │
│ minimum_price           │    ✅     │     ✅       │           │
│ maximum_price           │    ✅     │     ✅       │           │
│ features                │    ✅     │     ✅       │           │
│ description             │    ✅     │     ✅       │           │
│ tagline                 │    ✅     │     ✅       │           │
│ ical_url                │    ✅     │     ✅       │           │
│ connected_to_owner_ical │    ✅     │     ✅       │           │
│ price                   │           │     ✅       │           │
│ success                 │           │              │    ✅     │
│ price_data              │           │              │    ✅     │
│ start_date              │           │              │    ✅     │
│ end_date                │           │              │    ✅     │
│ amount                  │           │              │    ✅     │
│ currency_code           │           │              │    ✅     │
│ unit                    │           │              │    ✅     │
└─────────────────────────┴───────────┴──────────────┴───────────┘
```

---

*Documento basato su: Invenio Homes Data Export API V2.9.2 • Generato il 4 marzo 2026*
