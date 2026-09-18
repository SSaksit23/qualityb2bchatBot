# โบโบ้ — QualityB2B LINE agent

Read-only LINE assistant for internal sales and operations. Channel `2011654458`, basic ID `@719xcwgl`.

Production scope in v0.6:

- registered owner's private chat (group rollout remains disabled);
- signed, durable and deduplicated LINE webhook intake;
- `/bk`, `/tour`, `/help` and `/privacy` plus equivalent Thai questions;
- live read-only tour totals and booking status/counts through a server-owned browser session;
- deterministic Thai replies, separate seat/non-seat counts, inactive records excluded from active totals;
- paginated default, cancelled and rejected searches with incomplete-result rejection;
- 30-day job retention, unsend cancellation and idempotent outbound retries.

The product-search reader uses the live country and route catalog from the seat report for Go365, 2U Center and Teetiao. `BOBO_CATALOG_ROUTER_ENABLED` gates catalog-constrained language interpretation; disabling it restores the v0.5.3 router. Dates and seat counts are parsed locally, catalog keys are validated before browser access, and replies remain deterministic.

Payment details, deadlines, missing-field checks, alerts, Hermes, groups, change sheets and learning remain outside this release. Fixture implementations are not deployed capabilities.

The service has no booking-write operation. Requests to cancel, confirm, mark paid, remove travellers or issue documents return a human handoff. Staff make and save changes themselves on the Quality B2B website.

## Develop

Requires Node.js 24 or newer.

```powershell
npm ci --ignore-scripts
npx playwright install chromium
npm run check
npm test
```

The tests use `fixtures/bookings.json`; they do not access LINE or Quality B2B. Copy `.env.example` to a protected runtime environment only after obtaining the dedicated channel token, bot user ID, pilot identities and authenticated browser state. See [OPERATIONS.md](OPERATIONS.md).

Current rollout progress and remaining live prerequisites are recorded in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

`PROJECT_CONTEXT.md` and `INTEGRATION_PLAN.md` are source references. Where they describe automated booking saves, the project decision in this README takes precedence: โบโบ้ remains read-only and staff save changes themselves.
