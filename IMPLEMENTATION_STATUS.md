# Implementation status — 18 September 2026

## v0.6.2 — multiple authorized private chats

The owner can now add another private LINE chat with `/invite`; the new account completes `/join <single-use code>` within ten minutes. Invite values are stored only as hashes and never retained in job text. Each authorized user keeps isolated context and durable delivery state. Group access remains separately disabled.

## v0.6.1 — catalog-grounded NLP

Implemented a six-hour SQLite cache of the live Quality B2B country and route filters. Product-shaped first messages are reduced locally to destination, time and seat chunks. The structured model may select only keys from the current catalog; local code validates those keys and performs the read-only search. Complete new searches replace stale filters, while explicit refinements preserve unrelated date or seat filters. Health now reports catalog readiness and age, and content-free counters record rejection, model, catalog, browser and success stages.

All 49 local tests pass, including Playwright browser guards, privacy filtering, catalog-key rejection, context replacement, restart recovery and delivery deduplication. The catalog reader projects route labels directly from each verified endpoint response so it cannot race the page's dropdown update. Hostinger live catalog/model/search acceptance and private LINE confirmation are the remaining rollout gates.

## v0.5.3 — compact destination replacement

Within an active 30-minute product-search conversation, a short new destination plus date such as “ฉงชิ่ง ต.ค.” now reaches the structured planner without requiring “ขอโปรแกรม”. The earlier destination is context only; the current source phrase must supply and replace it. Without product context, unknown shorthand remains locally blocked unless it contains an explicit product-search cue, preserving the privacy boundary.

Version 0.5.3 is deployed on Hostinger. All 45 tests passed locally and on the server. The live gate replaced a simulated Qingdao context with `ฉงชิ่ง ต.ค.`, selected the exact website route `Chongqing`, and returned 12 programs / 23 October departures. The service restarted successfully with workflow enabled.

## v0.5.2 — new destinations replace saved search context

The local router now reuses product context only for clean refinements such as “เปลี่ยนเป็น ต.ค.”, “เอา 4 ที่” and “เฉพาะเหนือ”. A message containing a new destination phrase, including “ขอโปรแกรม ชิงเต่า ต.ค.”, falls through to the structured planner; its proposed country, menu and route must still match the live website filters. A recognized new destination also starts with the default one-seat threshold instead of carrying over the previous search's seat count.

Version 0.5.2 is deployed on Hostinger. All 44 tests passed locally and on the server. The live release gate interpreted the exact message after a simulated Xinjiang context, selected only `Qingdao`, reset the minimum to one seat, and returned 4 programs / 8 October departures from the website. The service restarted successfully with workflow enabled.

## v0.5.1 — deterministic shorthand and code routing

Implemented a local router ahead of the structured model call. A recognized destination plus a valid date phrase now searches directly, so short requests such as “ซินเจียง ต.ค.” no longer depend on model interpretation. Destination, date and seat count are extracted independently; harmless unknown filler and colloquial misspellings are discarded rather than forwarded. Thai digits, whitespace, punctuation and the safe variants `ใหน` and `มั่ง` are normalized for routing.

A single approved BK or tour code takes priority over product interpretation. `2UURC7NURCCA261226 จองแล้วกี่ที่` therefore goes directly to the validated tour-total reader even when the code and question are on separate lines. Multiple codes are clarified locally. Product refinements such as “4 ที่”, “เฉพาะเหนือ” and “เปลี่ยนเป็น ต.ค.” also use the stored 30-minute product context without a model call.

Version 0.5.1 is deployed on Hostinger with the existing workflow flag enabled. All 43 automated tests passed locally and on the server, including the three screenshot messages with a planner-call count of zero. The live typo-tolerant Xinjiang October search with a four-seat minimum returned 3 programs / 3 departures. The live `2UURC7NURCCA261226` read returned 3 active bookings / 8 seat-consuming passengers / 0 non-seat passengers. Private LINE receipt remains the final owner acceptance check.

## v0.5.0 — robust Thai destination and date interpretation

Implemented deterministic Thai month, explicit-range, relative-month and season resolution around the single structured model call. Xinjiang expands to the four verified website routes and is read sequentially, then deduplicated only when all operational facts agree. Model fields must quote exact source substrings; proposed generic routes are accepted only if the live report exposes the exact country, menu and route labels.

The predefined seasons are winter Nov–Feb, spring Feb–Mar, Songkran April, summer May–Sep and autumn Oct–Nov. An omitted month year means the current calendar year. An unspecified season uses the current or next season and clamps a season already underway to today. Replies display both the interpreted date range and exact website routes.

Version 0.5.0 is deployed on Hostinger with `BOBO_WORKFLOW_ENABLED=true`. The full 41-test suite and syntax checks passed both locally and on Hostinger. Fresh server reads at 15:57 Bangkok returned 4 Harbin programs / 8 departures and 4 Xinjiang programs / 17 departures; every formatted continuation accounted for every retrieved departure. The live `gpt-5.4-mini` structured calls passed “ขอซินเจียงหน้าหนาว”, “เฉพาะเหนือ” and “เปลี่ยนเป็น ต.ค.” with exact source-span validation. The remaining release check is owner confirmation from a real private LINE conversation.

The Quality B2B empty-result response is exactly “ไม่พบข้อมูลที่ค้นหา”; the reader now recognizes that verified response without waiting for a table. Any other non-table response still fails closed as unavailable.

## Current release: v0.4.0 clearer replies, LangGraph gated

The grouped formatter is deployed independently on Hostinger. A service-account read at 15:19 Bangkok verified 4 current programs / 8 departures across 2 complete replies. The 4,500-character budget and actual-display continuation use the shared deterministic formatter. Program names and owner groups come from the website.

LangGraph is implemented with one structured interpretation call, a maximum of three validated read-only tasks, deterministic output, persistent 30-minute sender/conversation context, and existing SQLite delivery/restart recovery. Unsend cancels both queued and in-flight derived replies. A booking lookup preserves the product continuation. Unknown/sensitive language is clarified locally. All 36 tests passed on Hostinger as the service account; the final 13-test workflow/privacy suite also passed after the last privacy guard update.

The existing Hermes OpenAI credential was reused only in the protected Bobo environment, with model gpt-5.4-mini. A real structured-model acceptance call passed. BOBO_WORKFLOW_ENABLED remains false pending the owner's private LINE acceptance. Disabling this flag preserves the improved formatter. No public route or other LINE service was changed. Current private acceptance request: Harbin New Year question, then ดูต่อ; graph follow-ups follow after enabling the flag.

Historical deployment notes below describe earlier states and are superseded by this section.


## Update: server login renewed and product filter fixed

The owner completed the official server-browser login. A fresh headless browser verified the saved session; a live booking read returned 3 bookings, 7 passengers and 21 allotted seats. The login viewer and temporary SSH forwarding were closed.

Product search now allows the verified read-only `POST /report/get_control_multi_sub_menu`, selects the menu before waiting for route options, and handles the pivot's empty two-column child prefix. The exact question “ฮาร์บินปีใหม่ มีที่ว่างไหม” is recognized. The live server read at 15:00 Bangkok returned 4 programs / 8 departures for 25 December 2026–5 January 2027: 2 open and 6 automatic-condition departures. This supersedes the authentication-blocked notes below. Real private LINE receipt remains the final user acceptance check.

## Live private booking reader deployed — v0.3.0

The v0.3 product-search implementation is installed on Hostinger with its independent feature flag disabled. Twenty-three automated tests pass locally; the same 22-test build before the final LINE-flow test passed on Hostinger as the service account. The reader enforces the three approved owners, verified read-only report endpoint, program pivot parsing, separate open/automatic categories, seat thresholds, New Year date rules and deterministic five-result replies.

Live product acceptance is blocked by authentication. On 18 September 2026 the existing saved state redirected to `/member/login`. After the active workstation session was signed out, Quality B2B rejected the supplied account in a browser running on Hostinger. Credential attempts were stopped as required. `B2B_PRODUCT_SEARCH_VERIFIED` remains unset/false, so `/search` cannot reach the website and no unverified product result can be sent. The booking session also needs renewal before live booking reads can become ready again.

- Verified channel: Bobo @719xcwgl, channel 2011654458.
- Isolated systemd service qualityb2b-bobo runs on Node 24 at 127.0.0.1:3212.
- Webhook: https://srv1925838.hstgr.cloud/bobo/webhook. LINE verification passed HTTP 200.
- Webhook delivery and redelivery enabled. Greeting disabled; response hours disabled with manual chat selected throughout the day.
- Dedicated credentials: /etc/qualityb2b-bobo/bobo.env (0600). Short-lived tokens issued automatically.
- Only the registered owner is authorized. No staff or pilot group configured; alerts inactive.
- The original eighteen booking tests passed locally and on Hostinger as the service account. Earlier duplicate signed `/help` delivery produced one queued reply accepted by LINE (done, attempts 1).
- Official browser login on Hostinger succeeded, and a fresh headless browser verified `/booking`. State is service-owned at `/var/lib/qualityb2b-bobo/auth/state.json`, mode 0600; no password was saved.
- Temporary noVNC/Xvfb login processes, loopback tunnel and temporary SSH forwarding exception were closed after verification.
- `B2B_LIVE_VERIFIED=true`; deterministic `/tour` and `/bk` replies are enabled. `/help` lists the limited live scope. Hermes is not used.
- A real owner message at 13:20:16 Bangkok was processed after the deployment restart; its single queued response reached `done` on attempt 1. The owner confirmed receipt and supplied the matching 3-booking / 7-passenger reply. The production reader reported `ready` with both supported capabilities.
- Owner-requested wording uses “ยอดจองทั้งหมด”, “ใช้ตั๋ว / ไม่ใช้ตั๋ว” and “ไซส์กรุ๊ป”, with status lines separated for readability. Active totals exclude cancelled/rejected bookings, which are explicitly shown separately when present.
- Existing line-hub, line-coach and nginx services remain active.

## Verified acceptance evidence

- Fresh server read at 13:19 Bangkok on 18 September 2026: `TTTAO5NTAOQW261105` — 3 bookings, 7 active passengers (7 seat-consuming / 0 non-seat), 21 allotted seats. Deposit-paid records contain 6 passengers; paid-in-full record contains 1. Values are read live, never hardcoded.
- `BK2026000375477` — deposit paid, 2 seat-consuming passengers; booking link validated.
- `TTUNKNOWN999999` — fully completed empty search; translated to “not found”, not a guessed passenger total.
- `TTNGO4NNRTXJ261006A` — 36 records: 11 active bookings / 29 passengers and 25 cancelled records / 101 excluded passengers. The cancelled scope spans two numbered pages and was read completely.
- `BK2026000378928` — a real non-seat case: 0 seat-consuming and 2 non-seat passengers. The reader matches the website table.
- Empty authentication state returns `SESSION_EXPIRED`. Both immediate and client-side redirects are handled. Expiry notification deduplication and deferred-feature refusal pass automated tests.
- Delayed results, incomplete/duplicate/changing pagination, changed headers, sensitive-field exclusion, blocked mutations, deterministic formatting, signature/access control, unsend, retention and delivery retry tests pass.
- Deployment restarted only Bobo after isolated server tests and a fresh live read. Prior code/env backup: `/var/lib/qualityb2b-bobo/rollback-20260918T061933Z`.
- Public HTTPS health confirms version 0.2.0 and booking readiness. Bobo, line-hub, line-coach and nginx are all active. No listeners remain on 5902/6082 and the temporary SSH exception is absent. The saved state remains owned by `qualityb2b-bobo`, mode 0600.

## Deferred

Payments, deadlines, missing-field checks, alerts, groups, agency access, Hermes, change sheets and learning remain disabled or fixture-only. The original full pilot acceptance suite and five-business-day observation are not complete. No booking mutation capability exists in this release.

Steps 1–7 of the full plan are not complete. Do not begin change sheets or group learning yet.

## Deployment notes

Use deploy/install-private.sh for private connectivity; the earlier install.sh is superseded for this phase. Code: /opt/qualityb2b-bobo. Data: /var/lib/qualityb2b-bobo. Nginx include: /etc/nginx/snippets/qualityb2b-bobo.conf. Original site configuration backup: /var/lib/line-hub/bobo-stage/nginx-before-bobo.conf. Roll back only the Bobo service and its include, preserving subsequent unrelated nginx edits.
