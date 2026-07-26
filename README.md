# EU Trust & Green Commerce Suite

All-in-one Shopify app for EU compliance and sustainability:

1. GDPR cookie consent banner with granular toggles
2. Customer data export / delete workflow
3. Privacy policy & terms auto-generator
4. Cookie scanner
5. Age verification popup
6. VAT / IOSS display
7. DSGVO/GDPR consent audit log
8. Carbon-neutral shipping calculator
9. Carbon offset upsell at checkout
10. Green courier integrations (DPD, GLS, DHL GoGreen)
11. Product carbon footprint badge
12. Sustainability report dashboard
13. EU legal pages template pack

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill credentials.
3. `npm run dev`
4. Configure Shopify app proxy URL to `https://your-domain.com/storefront` with subpath `eu-suite`.
5. Deploy theme app extension to add storefront blocks.

## API

- `/api/settings` - app settings
- `/api/consent-logs` - cookie consent audit
- `/api/data-requests` - GDPR data requests
- `/api/legal-pages` + `/api/generate-legal-pages`
- `/api/vat-settings`
- `/api/carbon-settings`, `/api/carbon-calculate`, `/api/carbon-orders`
- `/api/courier-settings`, `/api/courier/quote`
- `/api/sustainability-reports`
- `/api/cookie-scan`

## Storefront proxy

- `/apps/eu-suite/consent-banner`
- `/apps/eu-suite/age-verify`
- `/apps/eu-suite/vat-display`
- `/apps/eu-suite/carbon-badge`
- `/apps/eu-suite/carbon-widget`
- `/apps/eu-suite/carbon-offset`
