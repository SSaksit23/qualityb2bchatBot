# โบโบ้ operations

Version 0.6.1 caches only country/route catalog labels and keys from the verified seat report. It refreshes every six hours, after the protected browser state changes, and once after an unresolved destination. The structured model receives only extracted destination/time/seat chunks, normalized filter context, and the current catalog; it can return only catalog keys. City requests use route filters only. `/health` exposes `catalogRouter`, `catalogReady`, `catalogEntries`, `catalogAgeSeconds`, and `catalogVersion`.

Set `BOBO_CATALOG_ROUTER_ENABLED=true` only after `deploy/check-router-060.mjs` passes for Beijing, Chongqing, and Osaka. Set it false and restart only `qualityb2b-bobo` to restore the v0.5.3 workflow. The SQLite catalog and content-free metrics may remain. Roll back code from `/opt/qualityb2b-bobo/rollback-060` only if the reader itself regresses.

Additional private LINE chats are deny-by-default. The owner sends `/invite` to receive a single-use eight-character code valid for ten minutes. The other account adds the bot, then sends `/join <code>`. Only the SHA-256 hash of an unused invite is stored; `/join` text is never stored in a job. Successful accounts are retained in `authorized_users` and counted as `authorizedPrivateChats` in health without exposing their LINE IDs.

Version 0.5.3 permits compact destination-plus-date replacements while a product context is active. It does not loosen first-message handling for unknown words: use “ขอโปรแกรม <จุดหมาย> <เดือน>” to establish a new search when no context exists. The planner must return exact source spans and the reader must find the proposed route in the live website catalog.

The 18 September 2026 deployment passed all 45 tests. Its live context-replacement gate selected only `Chongqing` and returned 12 programs / 23 October departures. Rollback is available at `/opt/qualityb2b-bobo/rollback-053`.

Version 0.5.2 prevents a saved product search from overriding a new destination. Context is reused locally only for a clean date, seat or Xinjiang-route refinement. Other destination text reaches the structured planner and remains subject to exact source-span checks and live report-catalog validation. Deploy with `deploy/release-052.sh`; its live gate interprets and reads “ขอโปรแกรม ชิงเต่า ต.ค.” after a simulated Xinjiang search.

The 18 September 2026 deployment passed all 44 tests and the live gate returned 4 Qingdao programs / 8 October departures. Roll back to `/opt/qualityb2b-bobo/rollback-052` only if this routing release causes a regression.

Version 0.5.1 routes unambiguous shorthand and approved booking/tour codes locally before the LLM. A destination plus a recognized date is sufficient for product search; a seat count is an optional minimum. Unknown filler is not sent to the model or browser. A single approved code always takes priority, while multiple codes return a clarification. Deploy with `deploy/release-051.sh`; it runs the full suite and live checks the typo-tolerant Xinjiang query plus `2UURC7NURCCA261226` before replacing the service. The 18 September 2026 deployment passed all 43 tests, returned 3 matching Xinjiang programs / 3 departures for at least four seats, and verified the tour code at 3 active bookings / 8 passengers.

Service: `qualityb2b-bobo`; code: `/opt/qualityb2b-bobo`; listener: `127.0.0.1:3212`; public paths: `/bobo/webhook` and `/bobo/health`. Credentials: `/etc/qualityb2b-bobo/bobo.env` (0600). Data: `/var/lib/qualityb2b-bobo` (0700). Only the registered owner may use the private pilot. Do not reuse the project's older `.env` or another LINE bot's credentials.

Tour totals and booking status/counts are controlled by `B2B_LIVE_VERIFIED`. Product search has a separate `B2B_PRODUCT_SEARCH_VERIFIED` flag and must remain false until its live acceptance passes. Replies are deterministic; no booking or product data is sent to Hermes. Payments, deadlines, missing-field checks, alerts and groups remain disabled.

## Booking session renewal

1. An administrator stages `deploy/server-login.mjs` and `deploy/server-login.sh` in `/var/lib/line-hub/bobo-stage`, then runs `deploy/start-server-login.sh` as root on Hostinger. It starts an isolated browser as `qualityb2b-bobo`, with a maximum 25-minute lifetime.
2. Both viewer ports must listen only on `127.0.0.1`: VNC 5902 and noVNC 6082. `x11vnc -noipv6` is required. Do not create an nginx/public route.
3. For the current restricted SSH key, run `deploy/allow-login-tunnel.sh` as root to temporarily permit only local forwarding to `127.0.0.1:6082`. Open `ssh -F C:/Users/saksi/.ssh/line_hub_config -N -L 127.0.0.1:6082:127.0.0.1:6082 line-hub` on the workstation, then visit `http://127.0.0.1:6082/vnc.html?autoconnect=true&resize=scale`.
4. Enter credentials only on the official Quality B2B page. If remote typing fails, use noVNC's Clipboard panel and remote Ctrl+V (Extra keys → Ctrl, focus password, V, release Ctrl). Clear the temporary clipboard after use. Do not store passwords in files, scripts or logs.
5. The script requires `/booking` search controls and table, then verifies a fresh headless browser. Only after success does it atomically save `/var/lib/qualityb2b-bobo/auth/state.json` with service ownership and mode 0600. Check the content-free `/run/qualityb2b-bobo-login/status` for `SESSION_SAVED_AND_HEADLESS_VERIFIED`. The viewer disconnects automatically.
6. Always run `deploy/close-login.sh` as root, including on failure, and terminate the local tunnel. This removes the temporary SSH exception and stops the viewer. If the website rejects login, report its actual response and stop; do not repeat password attempts.
7. Run `deploy/check-booking.mjs` as the service account with `PLAYWRIGHT_BROWSERS_PATH=/opt/qualityb2b-bobo/browsers` and `B2B_STORAGE_STATE=/var/lib/qualityb2b-bobo/auth/state.json`, then test a private LINE lookup. A renewed state file is detected automatically on the next lookup. After restart health remains `unverified` until a successful live lookup.

The custom localhost login form and direct API login helpers are retired. Authentication state is a credential; never copy it into the repository or logs.

## Verified reader behavior

Product route loading also permits the verified read-only `POST /report/get_control_multi_sub_menu`. Select the menu, wait for its response and the requested route option, then submit the report. Do not broaden the guard to all report endpoints. Report results are cleared before each search so an earlier category cannot be read as a new response.

Only `POST /booking/get_booking`, `GET /booking`, the official login page and required same-origin static assets are allowed. Booking management, delete/save/print routes, contact-loading endpoints and unrelated hosts are blocked. The website Reset button clears required product scope; the reader restores `bk_status_agent=0` (B2B products) and `booking_type=1` (tours). It searches the default scope plus cancelled (11) and rejected (4) scopes separately. Other product types are outside this release.

Every numbered page is followed sequentially. Missing/duplicate pages, changed counts, conflicting rows or unknown table structure return unavailable. Inactive records are reported separately and excluded from active passenger totals. Allotment is a quota, not a claim of remaining inventory. Names, contacts, remarks, deadlines, payment amounts and raw HTML never enter reply objects. Session expiry suspends further reads of that state file and queues one durable owner notification per saved-session version.

The product reader permits only `GET /report/report_seat`, `POST /report/get_report_seat`, the login page and required same-origin static assets. It forces owners Go365, 2U Center and Teetiao; detailed format; grouping by program name; open products; remaining seats; and the requested departure range. It reads open and automatic-condition periods separately. Print, export, package management and every unrelated destination remain blocked. Enable it only after a live Harbin New Year read matches the website and the service survives a restart.

## Rollout gates

- `npm test` and `npm run check` pass locally and on the VPS.
- Port 3212 and `/bobo/*` are unused before installation.
- Bot info returns `@719xcwgl` and the expected bot user ID.
- The current channel webhook is empty or already equals `/bobo/webhook`; otherwise stop.
- Add the owner first and test `/help`, then one known booking. Add the pilot group only after private validation.
- Enable Use webhook and webhook redelivery; disable LINE OA greeting and automatic responses.

Monitor `/bobo/health` (`bookingState`, `productSearchState`, `capabilities`), systemd restarts, queue age and delivery status. Inspect SQLite counts/statuses only, not message content. Jobs and operational chat expire after 30 days; content-free unsend/replay identifiers remain. Run deployment with `deploy/enable-booking.sh`: it tests isolated staged code and a live lookup before stopping/replacing Bobo, and restores code/env on installation failure. It does not change nginx or other LINE services.

Rollback booking access by setting `B2B_LIVE_VERIFIED=false` and restarting only `qualityb2b-bobo`. Restore the previous reader/app from the timestamped `/var/lib/qualityb2b-bobo/rollback-*` directory if needed; retain the current database and protected authentication state. `/help` remains available. Do not remove the working webhook or change `line-hub`, `line-coach`, or nginx for a reader rollback.

Rollback only product search by setting `B2B_PRODUCT_SEARCH_VERIFIED=false` and restarting `qualityb2b-bobo`; booking lookup and the webhook remain installed.
## Version 0.4.0 — formatting and gated workflow

Product replies use the shared deterministic `product-format.mjs`: availability category, exact program name and owner, one field per line, complete departure blocks, at most five departures and 4,500 characters. Continuation advances by the number actually displayed. Each continuation re-reads the website.

`BOBO_WORKFLOW_ENABLED=false` retains the existing parser and improved formatting. Set true only after private acceptance and a successful structured-model check with the dedicated service's OPENAI_API_KEY/OPENAI_MODEL. The graph calls the model once (15 seconds), validates up to three tasks, executes only get/by_tour_code/search_products, then uses fixed Thai replies. Multiple product searches in one request ask for clarification; a single search can accompany two booking tasks. Unknown vocabulary or passenger/contact/secret data is clarified locally without a model call. Unsupported destinations remain unavailable. External LangSmith tracing is disabled.

Context is persisted in existing SQLite, isolated by LINE destination and sender, and expires after 30 minutes. Only normalized query/code and content-free source IDs are retained. Pending plans survive restart; website reads run fresh. Unsend clears associated context and plans and cancels dependent pending delivery. Overall reads are cancelled after 90 seconds. Multipart output shares one durable LINE retry key.

Rollback the interpretation feature by setting BOBO_WORKFLOW_ENABLED=false and restarting only qualityb2b-bobo. The improved formatter remains active. The release script also saves the previous code under /opt/qualityb2b-bobo/rollback-040 before installation. No nginx or other bot services are changed.

Private acceptance: send “ฮาร์บินปีใหม่ มีที่ว่างไหม”, inspect separated fields, then “ดูต่อ”. After enabling the graph, test “เอา 4 คน”, a booking code plus a Harbin search, /help, and /privacy. Confirm current facts and exactly one delivery per request. Do not enable group rollout here.

## Version 0.5.0 — Thai destination and calendar resolver

The model now returns exact source spans for destination, time and seats. Local code resolves and validates those spans; it never accepts model-generated dates directly. Supported Thai calendar forms include dotted or undotted month abbreviations, month numbers, Buddhist/Gregorian years, explicit ranges, relative months, month thirds and the configured seasons. Missing month years remain in the current calendar year, including past months.

Xinjiang expands to `Xinjiang`, `Northern Xinjaing`, `Southern Xinjiang` and `Western Xinjiang`; the first spelling is the website's current northern-route label. Each route and availability category is read sequentially. Exact duplicate departures merge; conflicting duplicates make the read unavailable. Generic model-proposed destinations must match the report's current country, menu and route options exactly.

Release with `deploy/release-050.sh`. It runs the full suite, a live Harbin and Xinjiang read, and model checks for the initial Xinjiang request plus route/date follow-ups before enabling `BOBO_WORKFLOW_ENABLED=true`. Roll back interpretation immediately by setting that flag false and restarting only `qualityb2b-bobo`; restore the saved v0.5 backup only if the reader itself must be reverted.

Deployment acceptance completed on 18 September 2026: Harbin returned 4 programs / 8 departures, Xinjiang returned 4 programs / 17 departures, and all three live model checks passed. The production service reports version 0.5.0 with workflow enabled. Immediately after a restart, booking and product readiness remain `unverified` until the first successful live lookup; this is expected and prevents a stale session from being reported as ready.
