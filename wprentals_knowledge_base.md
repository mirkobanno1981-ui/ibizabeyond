# 📚 WP Rentals — Knowledge Base Completa
## Tutte le Funzionalità + Mappatura Sync Invenio → WP Rentals

> Generato dall'analisi profonda del notebook NotebookLM "Invenio Homes: Documentazione Tecnica API V2.9.2"
> Fonti: 283 sorgenti (YouTube tutorials WP Rentals + API Postman + Invenio Data Export API V2.9.2)

---

## 🏗️ Parte 1 — Architettura WP Rentals

### Modalità di Funzionamento

| Modalità | Descrizione |
|----------|-------------|
| **Vacation Rental** | Affitto vacanze, calcolato a notte, con gestione ospiti |
| **Object Rental** | Noleggio oggetti/barche, calcolato a giorno o a ora |

### Ruoli Utente

| Ruolo | Capacità |
|-------|----------|
| **Amministratore** | Controllo totale su tema, impostazioni, proprietà, utenti, commissioni |
| **Proprietario (Owner)** | Pubblica/modifica le sue proprietà, gestisce prenotazioni, prezzi, calendario |
| **Ospite (Renter)** | Cerca, prenota, recensisce |

### Modelli: Single Owner vs Multi Owner

| Modello | Uso |
|---------|------|
| **Single Owner** | L'admin è l'unico proprietario. La registrazione owner è disabilitata |
| **Multi Owner** | Gli utenti si registrano come "Voglio affittare" → frontend dashboard completo |

---

## 📋 Parte 2 — Tutti i Campi di una Proprietà

### Campi Base (Meta Fields)

| Campo WP Rentals | Tipo | Campo Invenio Equivalente | Sincronizzabile via API? |
|---|---|---|:---:|
| `title` | string | `villa_name` | ✅ |
| `property_description` | string | `description` | ✅ |
| `property_price` | number | `minimum_price` | ✅ |
| `property_price_per_week` | number | — | ✅ (calcolabile) |
| `property_price_per_month` | number | — | ✅ (calcolabile) |
| `property_size` | number | — | ❌ Non presente in Invenio |
| `property_rooms` | number | — | ❌ Non presente |
| `property_bedrooms` | number | `bedrooms` | ✅ |
| `property_bathrooms` | number | `bathrooms` | ✅ |
| `property_address` | string | `areaname` + `district` | ✅ (da comporre) |
| `property_zip` | string | — | ❌ Non presente |
| `property_country` | string | `country` | ✅ |
| `property_label` | string | `tagline` | ✅ |
| `property_label_before` | string | — | ✅ (es. "A partire da") |
| `local_booking_type` | string | — | ✅ (impostare "per_night") |
| `images` | array | `photos` + `thumbnails` | ✅ |

### Tassonomie

| Tassonomia WP Rentals | Campo Invenio Equivalente | Sincronizzabile? |
|---|---|:---:|
| `property_category` | — | ⚙️ Da mappare manualmente |
| `property_action_category` | — | ⚙️ Impostare "Affitto" |
| `property_city` | `destination` | ✅ |
| `property_area` | `areaname` / `district` | ✅ |
| `property_features` | `features` | ✅ (richiede parsing) |

### Campi Avanzati

| Campo WP Rentals | Campo Invenio | Sincronizzabile? | Note |
|---|---|:---:|---|
| `custom_price` | `price_data` endpoint Price | ⚠️ Parziale | Vedi sezione dedicata sotto |
| `extra_pay_options` | — | ❌ | Servizi extra a pagamento |
| `beds_options` | — | ❌ | Configurazione letti per stanza |
| `custom_fields` | Qualsiasi campo custom | ✅ (via slug/value) | Per campi specifici |
| `ical_feeds` | `ical_url` | ✅ | URL iCal per sync calendario |

---

## 💰 Parte 3 — Gestione Prezzi (Dettaglio Critico)

### Struttura Prezzi WP Rentals

```
├── Prezzo base (per notte)
├── Prezzo weekend (diverso da infrasettimanale)  
├── Prezzo settimanale (7+ notti)
├── Prezzo mensile (30+ notti)
├── Custom Price (per periodo specifico)
│   ├── date_range: { from, to }
│   ├── price: prezzo notte per quel periodo
│   └── details:
│       ├── prezzo weekend
│       ├── prezzo ospite extra
│       ├── notti minime
│       └── giorno check-in obbligatorio
├── Cleaning fee (fisso, a notte, a ospite, o a notte+ospite)
├── City tax
├── Deposito cauzionale
├── Extra options (servizi aggiuntivi)
└── Early bird discount (sconto prenotazione anticipata)
```

### Struttura `custom_price` per l'API

```json
{
  "custom_price": [
    {
      "date_range": {
        "from": "2026-06-01",
        "to": "2026-08-31"
      },
      "price": "350",
      "details": {
        "weekend_price": "400",
        "extra_guest_price": "50",
        "minimum_nights": "7",
        "checkin_day": "saturday"
      }
    }
  ]
}
```

---

## 🔄 Parte 4 — Mappatura Sync Invenio → WP Rentals

### ✅ Campi SINCRONIZZABILI automaticamente (via API n8n)

| # | Da Invenio | A WP Rentals | Metodo |
|---|-----------|-------------|--------|
| 1 | `villa_name` | `title` | Diretto |
| 2 | `description` | `property_description` (meta) | Diretto |
| 3 | `bedrooms` | `property_bedrooms` (meta) | Diretto |
| 4 | `bathrooms` | `property_bathrooms` (meta) | Diretto |
| 5 | `sleeps` | Guest capacity | Diretto |
| 6 | `country` | `property_country` (meta) | Diretto |
| 7 | `destination` | `property_city` (taxonomy) | Diretto |
| 8 | `areaname` + `district` | `property_area` (taxonomy) | Concatenare |
| 9 | `tagline` | `property_label` (meta) | Diretto |
| 10 | `photos[]` | `images[]` (url) | Download + Upload |
| 11 | `features` | `property_features` (taxonomy) | Parsing → array |
| 12 | `minimum_price` | `property_price` (meta) | Diretto |
| 13 | `maximum_price` | Custom field o label | Diretto |
| 14 | `gps` | Mappa (lat/lng) | Parsing coordinate |
| 15 | `deposit` | Deposito (meta) | Diretto |
| 16 | `cleaning_charge` | Cleaning fee (meta) | Diretto |
| 17 | `ical_url` | `ical_feeds` (feed URL) | Diretto |
| 18 | `license` | Custom field | Via slug/value |
| 19 | `v_uuid` | Custom field (ID Invenio) | Via slug/value |
| 20 | `check_in` / `check_out` | Custom fields | Via slug/value |

### ⚠️ Campi PARZIALMENTE sincronizzabili

| # | Da Invenio | A WP Rentals | Problema |
|---|-----------|-------------|---------|
| 21 | `price_data[].amount` | `custom_price[].price` | Invenio usa "Night" come unità → calcolo diretto. Ma il campo `details` (weekend, min nights, checkin day) **non è presente** in Invenio |
| 22 | `price_data[].minimum_nights` | `custom_price[].details.minimum_nights` | ✅ Sincronizzabile dal Price endpoint! |
| 23 | `price_data[].allowed_checkin_days` | `custom_price[].details.checkin_day` | ✅ Sincronizzabile dal Price endpoint! |

### ❌ Campi NON SINCRONIZZABILI (gestione manuale dal frontend)

| # | Campo WP Rentals | Perché non sincronizzabile | Gestione |
|---|---|---|---|
| 1 | **Prezzo weekend** | Non presente nell'API Invenio | 👤 Owner dal frontend: Edit Property → Price → Weekend Price |
| 2 | **Extra options** (servizi aggiuntivi a pagamento) | Non presente in Invenio | 👤 Owner dal frontend: Edit Property → Price → Extra Options |
| 3 | **Early bird discount** | Non presente in Invenio | 👤 Admin dal backend: Theme Options → Booking |
| 4 | **City tax** | Non presente in Invenio | 👤 Owner dal frontend: Edit Property → Price → City Tax |
| 5 | **Beds configuration** (tipo letti per stanza) | Non presente in Invenio | 👤 Owner dal frontend: Edit Property → Details → Beds |
| 6 | **Property size** (m²) | Non presente in Invenio | 👤 Owner dal frontend: Edit Property → Details |
| 7 | **Video / Virtual Tour** | Non presente in Invenio | 👤 Owner dal frontend: Edit Property → Images → Video/Tour |
| 8 | **Termini e condizioni** | Specifico per ogni villa | 👤 Owner dal frontend: Edit Property → Details |
| 9 | **Instant Booking on/off** | Scelta business | 👤 Owner dal frontend: Edit Property → Description |
| 10 | **Profilo proprietario** (foto, bio) | Non in Invenio | 👤 Owner dalla Dashboard → My Profile |

---

## 🖥️ Parte 5 — Dashboard Proprietario (Frontend)

### Sezioni della Dashboard

| Sezione | Funzionalità |
|---------|--------------|
| **Account Summary** | Statistiche: proprietà pubblicate, prenotazioni in arrivo, visite |
| **My Profile** | Foto, bio, contatti, documenti per verifica account |
| **My Listings** | Lista proprietà con azioni: Modifica, Elimina, Disabilita, In Evidenza |
| **Add New Listing** | Form completo per aggiungere nuova proprietà (7 sezioni) |
| **All-in-One Calendar** | Calendario globale di tutte le proprietà |
| **My Bookings** | Prenotazioni ricevute: conferma/rifiuta + emetti fattura |
| **My Reservations** | Prenotazioni effettuate come ospite |
| **Inbox** | Messaggistica con gli ospiti (admin ha accesso completo) |
| **My Reviews** | Feedback ricevuti + risposte pubbliche |
| **Invoices** | Fatture per pagamenti, abbonamenti, commissioni |
| **Saved Properties** | Proprietà salvate come preferiti |

### Form di Inserimento (7 Sezioni Frontend)

| # | Sezione | Campi principali |
|---|---------|-----------------|
| 1 | **Description** | Titolo, categoria, tipo stanza, ospiti, descrizione, Instant Booking on/off |
| 2 | **Price** | Prezzo/notte, tasse, pulizie, city tax, deposito, **Custom Price per periodo** |
| 3 | **Images** | Galleria foto, immagine in evidenza, video YouTube/Vimeo, virtual tour |
| 4 | **Details** | Dimensioni, stanze, camere, letti, bagni, campi custom, T&C |
| 5 | **Location** | Indirizzo con autocompletamento, CAP, stato, pin sulla mappa |
| 6 | **Amenities** | Checkbox per features (Wi-Fi, piscina, ecc.) |
| 7 | **Calendar** | Blocco date manuali + iCal feed sync |

### ⚡ Cosa può modificare il proprietario dal frontend

| Parametro | Modificabile dal frontend? | Dove |
|-----------|:---:|---|
| Prezzo per notte | ✅ | Edit Property → Price |
| Prezzo weekend | ✅ | Edit Property → Price → Weekend Price |
| Prezzi personalizzati per periodo | ✅ | Edit Property → Price → Custom Price calendar |
| Notti minime (globali) | ✅ | Edit Property → Price → Minimum nights |
| Notti minime (per periodo) | ✅ | Edit Property → Price → Custom Price → Min nights |
| Giorno check-in obbligatorio | ✅ | Edit Property → Price → Start/End date day |
| Sabato-Sabato | ✅ | Min nights = 7 + Start date = Saturday |
| iCal sync | ✅ | Edit Property → Calendar → iCal feeds |
| Foto, video, tour | ✅ | Edit Property → Images |
| Features/amenities | ✅ | Edit Property → Amenities |

---

## 🔧 Parte 6 — Configurazione "Sabato a Sabato" (Step by Step)

Per forzare prenotazioni **settimanali da Sabato a Sabato**:

1. **Notti minime = 7** → Edit Property → Price → "Minimum nights of booking" → `7`
2. **Giorno di check-in = Sabato** → Edit Property → Price → "Start date" → seleziona **Saturday**
3. **Risultato**: Il calendario bloccherà automaticamente ogni giorno diverso dal sabato come check-in
4. **Prezzo settimanale**: Impostare `property_price_per_week` via API, oppure dal frontend il prezzo × 7 notti

> [!NOTE]
> WP Rentals permette di vincolare il giorno di **inizio** OPPURE di **fine**, ma non entrambi contemporaneamente.

---

## 🔌 Parte 7 — API WP Rentals (Riferimento Rapido)

### Autenticazione

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| **POST** | `/wp-json/jwt-auth/v1/token` | Ottieni token JWT con username+password |

Headers per endpoint protetti:
```
Authorization: Bearer {token}
Content-Type: application/json
```

### Endpoint Principali

| Metodo | Endpoint | Auth | Descrizione |
|--------|----------|:---:|-------------|
| POST | `/wp-json/wprentals/v1/properties` | ❌ | Lista proprietà (con filtri) |
| GET | `/wp-json/wprentals/v1/property/{id}` | ❌ | Dettagli proprietà |
| POST | `/wp-json/wprentals/v1/property/add/` | ✅ | Crea proprietà |
| PUT | `/wp-json/wprentals/v1/property/edit/{id}` | ✅ | Modifica proprietà |
| DEL | `/wp-json/wprentals/v1/property/{id}` | ✅ | Elimina proprietà |
| GET | `/wp-json/wprentals/v1/booking/availability` | ❌ | Controlla disponibilità |
| GET | `/wp-json/wprentals/v1/booking/estimate` | ❌ | Stima costo prenotazione |
| POST | `/wp-json/wprentals/v1/property/add/` | ✅ | Crea prenotazione |
| POST | `/wp-json/wprentals/v1/bookings` | ✅ | Lista prenotazioni |
| GET | `/wp-json/wprentals/v1/booking/{id}` | ✅ | Dettagli prenotazione |

---

## 📊 Parte 8 — Riepilogo Sync Invenio → WP Rentals

```
 INVENIO API                          WP RENTALS (via n8n)
 ═══════════                          ═══════════════════
 Endpoint Villas ──────────────────►  POST /property/add
   villa_name ─────────────────────►    title
   description ────────────────────►    property_description
   bedrooms ───────────────────────►    property_bedrooms  
   bathrooms ──────────────────────►    property_bathrooms
   sleeps ─────────────────────────►    guest capacity
   destination ────────────────────►    property_city
   areaname ───────────────────────►    property_area
   country ────────────────────────►    property_country
   tagline ────────────────────────►    property_label
   photos[] ───────────────────────►    images[]
   features ───────────────────────►    property_features
   minimum_price ──────────────────►    property_price
   deposit ────────────────────────►    deposito
   cleaning_charge ────────────────►    cleaning fee
   gps ────────────────────────────►    lat/lng mappa
   ical_url ───────────────────────►    ical_feeds
   license ────────────────────────►    custom_field
   v_uuid ─────────────────────────►    custom_field (ID)

 Endpoint Price ───────────────────►  PUT /property/edit/{id}
   price_data[v_uuid][] ──────────►    custom_price[]
     start_date ───────────────────►      date_range.from
     end_date ─────────────────────►      date_range.to
     amount ───────────────────────►      price
     minimum_nights ───────────────►      details.minimum_nights
     allowed_checkin_days ─────────►      details.checkin_day

 ❌ NON in Invenio (gestione manuale frontend):
   • Prezzo weekend
   • Extra options / servizi aggiuntivi
   • Early bird discount
   • City tax
   • Configurazione letti
   • Dimensioni proprietà (m²)
   • Video / Virtual Tour
   • Termini e condizioni
```

---

*Knowledge Base generata il 4 marzo 2026 — Fonte: NotebookLM "Invenio Homes" (283 sorgenti)*
