# Ibiza Beyond – Reseller Platform

> B2B luxury property & yacht rental reseller platform for agents operating in Ibiza. Agents create quotes for clients, manage villa/boat/service listings, handle bookings, payouts, and contracts.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 6, JSX (no TypeScript) |
| Styling | TailwindCSS 3.4 + CSS custom properties (dark mode via `.dark` class) |
| State Management | TanStack React Query v5 (`@tanstack/react-query`) |
| Routing | react-router-dom v6 (BrowserRouter) |
| Backend / DB | Supabase (PostgreSQL, Auth, Storage, Edge Functions, RLS) |
| Server | Express.js SSR for OG meta injection on `/quote/:id` |
| Payments | Stripe (Connect, Checkout, Invoices, Webhooks) |
| Automation | n8n self-hosted at `n8n.ibizabeyond.com` |
| PDF | jsPDF + html2canvas, pdfjs-dist for extraction |
| Contracts | Documenso (digital signatures) |
| Deploy | Docker → Google Cloud Run via Cloud Build (europe-west1) |
| Fonts | Manrope (display), Inter (fallback) |
| Maps | Google Maps API (geocoding, GPS picker) |

## Project Structure

```
├── src/
│   ├── App.jsx               # Root: routing, providers, guards
│   ├── main.jsx              # React entry point
│   ├── index.css             # Tailwind + CSS custom properties (theme)
│   ├── components/           # All page & UI components (46 files)
│   │   └── admin/            # Admin-only components
│   ├── contexts/
│   │   ├── AuthContext.jsx    # Auth, roles, permissions, brand colors
│   │   ├── ThemeContext.jsx   # Dark/light mode toggle
│   │   └── GlobalSettingsContext.jsx  # global_settings from DB
│   └── lib/                  # Utilities & API helpers
│       ├── supabase.js        # Supabase client (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
│       ├── quoteMath.js       # Commission, margin, IVA calculations
│       ├── calendar.js        # iCal sync, date helpers
│       ├── imageResize.js     # Client-side image optimization
│       ├── villaPdfExport.js  # PDF generation for villa fact sheets
│       ├── colorExtract.js    # Extract dominant color from images
│       ├── boatPricing.js     # Boat pricing logic
│       ├── favorites.js       # Favorites CRUD
│       ├── stripe.js          # Stripe helpers
│       ├── *IngestApi.js      # AI-powered property/boat ingestion
│       └── *AiEditApi.js      # AI-powered editing via edge functions
├── server.js                 # Express production server (OG meta SSR)
├── supabase/
│   ├── functions/            # 20 Deno edge functions
│   └── migrations/           # 43 SQL migration files
├── contracts/                # Contract templates (B2B/B2C markdown + PDF)
├── n8n/workflows/            # n8n workflow JSON exports
├── docs/RELEASES/            # Release notes (v1.0.1, v1.0.2, v1.0.4)
├── Dockerfile                # Multi-stage: build (Vite) → serve (Express)
├── cloudbuild.yaml           # Google Cloud Build pipeline
└── docker-compose*.yml       # Dev, n8n, Odoo compose files
```

## Architecture & Key Patterns

### Authentication & Authorization
- **Supabase Auth** handles login/signup (email + password)
- `AuthContext.jsx` fetches role, agent/owner data, and category permissions on login
- **Roles**: `super_admin`, `admin`, `agency_admin`, `agent`, `editor`, `owner`
- **Category permissions**: per-user `can_view` / `can_add` on categories (`villa_licensed`, `villa_unlicensed`, `apartment`, `boat`)
- **Super admin**: hardcoded to `info@ibizabeyond.com`
- **Route guards**: `ProtectedRoute`, `AdminRoute`, `SuperAdminRoute`, `OwnersRoute` in App.jsx
- **Brand colors**: agents can have custom `brand_primary_color` / `brand_accent_color` applied to CSS variables at runtime

### Data Model (Core Tables)
| Table | Purpose |
|---|---|
| `owners` | Property/boat owners |
| `agents` | Platform agents (individual, collaborator, agency, sub_agent, agency_admin) |
| `clients` | Agent's clients |
| `properties` (aka `invenio_properties`) | Villa/apartment listings |
| `boats` (aka `invenio_boats`) | Yacht/boat listings |
| `property_photos` / `invenio_photos` | Media for listings |
| `seasonal_prices` / `invenio_seasonal_prices` | Date-range pricing |
| `quotes` | Proposals sent to clients (with status workflow) |
| `guests` | Guest details per booking |
| `global_settings` | Platform-wide config (margin, IVA, company info, feature flags) |
| `margin_settings` | Commission settings |
| `user_roles` | Maps user → role |
| `user_category_permissions` | Granular category access |
| `user_favorites` | Agent saved listings |
| `villa_blocked_dates` | iCal-synced availability |
| `services` | Concierge services catalog |
| `amenity_catalog` | Standardized amenity list |
| `cities` / `areas` | Location hierarchy |

### Quote Status Workflow
`draft` → `sent` → `waiting_owner` → `booked` → `check_in_ready` → `completed`
Alternative paths: `owner_declined`, `details_requested`, `contract_sent`, `contract_signed`, `cancelled`, `expired`

### Supabase Edge Functions (Deno)
| Function | Purpose |
|---|---|
| `property-ingest` | AI-powered villa data extraction from PDF/images |
| `boat-ingest` | AI-powered boat data extraction |
| `villa-ai-edit` / `boat-ai-edit` | Natural language editing of listings |
| `stripe-checkout` | Create Stripe checkout session |
| `stripe-webhook` | Handle Stripe events |
| `stripe-connect-express` | Onboard owners to Stripe Connect |
| `stripe-payout` | Process payouts to owners |
| `stripe-create-invoice` | Generate Stripe invoices |
| `stripe-oauth-callback` | Stripe OAuth flow |
| `notify-owner` | Email owner for availability confirmation |
| `calendar-feed` | Generate iCal feeds |
| `sync-ical` | Sync external iCal calendars |
| `geocode-location` | Google Maps geocoding |
| `documenso-contract` | Create digital contracts |
| `documenso-webhook` | Handle contract signing events |
| `manage-security-deposit` | Security deposit lifecycle |
| `ses-hospedajes-submit` | Spanish tourist registration |
| `admin-set-password` | Admin password management |
| `ai-support` | AI assistant for agents |

## Environment Variables

```
VITE_SUPABASE_URL=https://nqnwmotrjlbqdnrwcyfz.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_key>
VITE_GOOGLE_MAPS_API_KEY=<google_maps_key>
```

## Coding Conventions

### General
- **Language**: JavaScript only (no TypeScript). JSX for React components.
- **Modules**: ES Modules (`import`/`export`), `"type": "module"` in package.json
- **Component pattern**: One component per file in `src/components/`. Files are large and self-contained (some 50k+ lines).
- **State**: Use TanStack React Query for server state. Local state via `useState`/`useReducer`.
- **Styling**: Tailwind utility classes + custom CSS variables defined in `index.css`. Theme tokens: `--primary`, `--accent`, `--background`, `--surface`, `--surface-2`, `--border`, `--text-primary`, `--text-secondary`, `--text-muted`.
- **Component classes**: `glass-card`, `btn-primary`, `nav-link`, `stat-card`, `input-theme` (defined in index.css `@layer components`).
- **Dark mode**: Toggle via `.dark` class on `<html>`. Use Tailwind's `dark:` prefix or CSS variables.

### Supabase
- Client initialized in `src/lib/supabase.js` using `import.meta.env` variables
- Always use `.maybeSingle()` for single-row queries
- RLS (Row Level Security) is enforced on all tables
- Migrations go in `supabase/migrations/` with timestamp naming: `YYYYMMDDHHMMSS_description.sql`
- Edge functions are Deno-based in `supabase/functions/<function-name>/index.ts`

### Commission & Pricing
- Quote calculations in `src/lib/quoteMath.js` — admin margin, agent commission, IVA split
- Boat pricing in `src/lib/boatPricing.js`
- Capturer commission for referrals in `src/lib/capturerCommission.js`

### Express Server (Production)
- `server.js` serves the Vite build from `dist/` and injects OG meta tags server-side for `/quote/:id` routes
- Fetches quote data from Supabase REST API to build dynamic OpenGraph tags for social sharing
- Runs on port 8080 inside Docker

## Deploy Pipeline

1. Push to repo triggers Cloud Build (`cloudbuild.yaml`)
2. Docker multi-stage build: `node:20-alpine` → Vite build → Express serve
3. Image pushed to Artifact Registry: `europe-west1-docker.pkg.dev/ibzabeyond/ibizabeyond-repo/ibizabeyond-frontend`
4. Deployed to Cloud Run (europe-west1, port 8080, allow unauthenticated)
5. Domain: `reseller.ibizabeyond.com`

## URLs & Services
| Service | URL |
|---|---|
| Production app | https://reseller.ibizabeyond.com |
| Supabase | https://nqnwmotrjlbqdnrwcyfz.supabase.co |
| n8n | https://n8n.ibizabeyond.com |
| Cloud Run | https://ibizabeyond-frontend-ghnip6oyiq-ew.a.run.app |
| Supplier API | https://api.inveniohomes.com/plapi/getdata/ |

## Development

```bash
# Install dependencies
npm install

# Start dev server (Vite HMR)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Start production server (requires build first)
npm start
```

## Important Notes

- **Large components**: Some components are 50–115KB. Be careful with full-file rewrites.
- **Supabase RLS**: All DB operations go through the authenticated Supabase client. Never bypass RLS.
- **Commission logic is critical**: Changes to `quoteMath.js` or `boatPricing.js` affect billing. Test thoroughly.
- **OG tags**: The Express server handles social sharing previews. Changes to `server.js` affect WhatsApp/social link previews.
- **Brand customization**: Agent brand colors dynamically override `--primary` and `--accent` CSS variables.
- **Italian/English mix**: Code comments and some UI strings are in Italian. Public-facing UI is in English.
- **No TypeScript**: This is a JS-only project. Do not introduce .ts/.tsx files.
