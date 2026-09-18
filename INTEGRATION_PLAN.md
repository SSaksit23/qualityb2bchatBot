# LINE ↔ Hermes ↔ Quality B2B — Integration Plan

- **Version:** 0.1 (draft for review)
- **Date:** 18 Sep 2026
- **Target site:** https://www.qualityb2bpackage.com (no public API)
- **Agent runtime:** Hermes, self-hosted on Hostinger
- **Channel:** LINE Messaging API (new channel + new Official Account)

> Companion to [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md), which holds the
> back-office site spec, status vocabulary, block layout, and agent guardrails.
> This document covers how that servicing agent is wired to LINE via Hermes.

---

## 0. Assumptions and open questions

Confirm these before build starts — several change the design materially.

| # | Assumption | Impact if wrong |
|---|---|---|
| A1 | Hermes runs on a **Hostinger VPS**, not shared hosting | Shared hosting cannot run headless Chromium or long-lived workers; the whole browser-automation layer breaks |
| A2 | Hermes exposes an HTTP entrypoint and supports registering custom tools/functions | Determines whether the LINE gateway is inside Hermes or a separate service in front of it |
| A3 | The LINE Official Account will be **Verified or Premium** | `GET /v2/bot/group/{groupId}/members/ids` is *verified/premium only*; without it you cannot enumerate group members and must build the staff↔LINE-user map from observed `userId` values instead |
| A4 | You own admin rights on the existing sales/ops LINE groups | The bot must be invited into each group; only one Official Account can sit in a group at a time |
| A5 | The back-office session can be held by a service account | Otherwise every action needs a fresh human login |
| A6 | Thai PDPA applies to the traveller PII flowing through this | Drives retention, redaction, and audit requirements |

**Open questions for you**

1. Is Hermes a single-process agent or does it support multiple named agents/workers? The plan assumes at least two roles (conversational agent, booking worker).
2. Which LLM backend does Hermes call, and is it acceptable for Thai-language chat containing passport numbers to leave your infrastructure? This decides whether PII redaction happens before or after the model call.
3. Do you already have chat history exported from the LINE groups (the LINE app can export chat text)? If yes, the knowledge graph can be seeded. If not, it starts empty and learns forward only.
4. Is there any existing LINE OA already in those groups? It would have to be removed first.
5. Should the agent ever write to the booking system unattended, or is approval-in-LINE always required? The plan assumes always required.

---

## 1. Goals and scope

### In scope

1. **Group Q&A** — the agent sits in sales↔operations and sales↔agent LINE groups, recognises questions it has seen patterns for, and answers with grounded data (booking status, deadlines, seat availability, FAQ).
2. **Booking servicing** — from LINE, staff can ask the agent to look up a booking, add pax, fill traveller details, prepare a VAT invoice, and check countdowns. All writes are staged and human-approved.
3. **Proactive alerts** — the agent pushes deadline warnings into the right group before a booking auto-cancels.
4. **Pattern learning** — a knowledge graph built from group conversation captures how sales talks to ops, how sales talks to agencies, recurring questions, canonical answers, and the real escalation flow.

### Explicitly out of scope

- Cancelling, confirming, rejecting, deleting, marking-as-paid, approving payments, or issuing final documents in the booking system. These stay human. See §7.3.
- Talking to end travellers. The bot serves internal staff and partner agencies only.
- Replacing the back-office UI. The agent is an accelerator, not a system of record.

---

## 2. Architecture

```
                    ┌──────────────────────────────────────┐
  LINE users        │            LINE Platform             │
  (sales, ops,      │  OA "xxx" · Messaging API channel    │
   agency staff)    └───────┬──────────────────────▲───────┘
        │                   │ webhook POST         │ reply / push
        └───────────────────┤ (HTTPS, signed)      │
                            ▼                      │
╔═══════════════════════════════════════════════════════════════╗
║  HOSTINGER VPS                                                ║
║                                                               ║
║  ┌─────────────────────────────────────────────────────────┐  ║
║  │ 1. LINE Gateway  (FastAPI / Express)                    │  ║
║  │    · verify x-line-signature                            │  ║
║  │    · dedupe on webhookEventId                           │  ║
║  │    · return 200 in <1s, enqueue, never block            │  ║
║  └──────────┬──────────────────────────────┬───────────────┘  ║
║             │ every message                │ addressed to bot  ║
║             ▼                              ▼                   ║
║  ┌────────────────────┐        ┌──────────────────────────┐   ║
║  │ 2. Ingest Worker   │        │ 3. Hermes Agent          │   ║
║  │  · raw msg store   │        │  · intent routing        │   ║
║  │  · PII redaction   │        │  · tool calling          │   ║
║  │  · thread stitching│        │  · answer composition    │   ║
║  └─────────┬──────────┘        └───┬──────────────┬───────┘   ║
║            ▼                       │              │           ║
║  ┌────────────────────┐            │              │           ║
║  │ 4. KG Builder      │            │ retrieve     │ act       ║
║  │  (batch, nightly)  │            ▼              ▼           ║
║  │  · entity extract  │   ┌──────────────┐  ┌──────────────┐  ║
║  │  · relation extract│   │ 5. Knowledge │  │ 6. Booking   │  ║
║  │  · QA-pair mining  │──▶│    Graph     │  │    Adapter   │  ║
║  └────────────────────┘   │  Neo4j +     │  │  (Playwright │  ║
║                           │  pgvector    │  │   worker)    │  ║
║  ┌────────────────────┐   └──────────────┘  └──────┬───────┘  ║
║  │ 7. Scheduler       │                            │          ║
║  │  · deadline sweep  │───────────────────────────▶│          ║
║  │  · daily digest    │                            │          ║
║  └────────────────────┘                            │          ║
║                                                     │          ║
║  ┌────────────────────┐   ┌──────────────┐          │          ║
║  │ 8. Approval Store  │   │ 9. Audit Log │          │          ║
║  └────────────────────┘   └──────────────┘          │          ║
╚═════════════════════════════════════════════════════╪══════════╝
                                                      ▼
                              ┌──────────────────────────────────┐
                              │  qualityb2bpackage.com           │
                              │  (legacy PHP back-office, no API)│
                              └──────────────────────────────────┘
```

---

## 3. Components

### 3.1 LINE Gateway

The only public surface. Thin by design.

- Single HTTPS endpoint, e.g. `POST /line/webhook`. LINE permits **one** webhook URL per channel and requires a CA-issued certificate — self-signed is rejected.
- **Verify `x-line-signature`** (HMAC-SHA256 of the raw body with the channel secret) before parsing. Reject on mismatch. Compare in constant time.
- **Return 2xx immediately**, then process asynchronously. If the server stops returning 2xx, LINE may suspend webhook delivery.
- **Deduplicate on `webhookEventId`.** With redelivery enabled the same event can arrive more than once, and redelivered events can arrive out of order — order by `timestamp`, not arrival.
- Enqueue to Redis/RabbitMQ. Two fan-outs: everything goes to the Ingest Worker; only messages addressed to the bot go to Hermes.

### 3.2 Ingest Worker

Consumes every message event for corpus building.

- Persist raw event JSON plus normalised fields (see §8.1).
- Stitch threads: LINE has no thread concept, so use `quotedMessageId` where present, plus a time-and-participant heuristic (same group, ≤10 min gap, ≤3 speakers) to group messages into conversations.
- Redact PII before anything leaves the VPS for an LLM: passport numbers, national IDs, phone numbers, card fragments. Store redacted and raw separately; only redacted text is embedded or sent to a hosted model.
- Handle `unsend` events by hard-deleting the message from raw store, corpus, embeddings and graph. LINE's guidance is explicit that unsent messages must not remain usable.

### 3.3 Hermes Agent

The reasoning layer. Receives a normalised turn plus context and decides: answer from KG, call a booking tool, ask a clarifying question, or escalate.

Registered tools — read tools are free to call, write tools require approval:

| Tool | Type | Purpose |
|---|---|---|
| `kg.search(query, group_scope)` | read | Retrieve similar past Q&A, canonical answers, flow knowledge |
| `booking.find(code \| tour_code \| name)` | read | Locate booking(s) |
| `booking.get(id)` | read | Full booking snapshot |
| `booking.countdown(id \| filter)` | read | Time-remaining tracking (§7.2) |
| `booking.by_tour_code(code)` | read | Bookings, pax, allotment for a departure |
| `booking.missing_fields(filter)` | read | `ข้อมูลผู้เดินทางไม่ครบ` triage |
| `booking.stage_add_pax(id, line, qty)` | **write-staged** | Prepare headcount increase |
| `booking.stage_pax_details(id, row, fields)` | **write-staged** | Prepare traveller data fill |
| `booking.stage_charge(id, type, amount, ...)` | **write-staged** | Prepare ad-hoc charge line |
| `booking.stage_vat_doc(id, header, branch, rate, doc)` | **write-staged** | Prepare invoice config |
| `approval.request(payload)` | write | Post a Flex approval card to LINE |
| `escalate(reason, target)` | write | Hand off to a named human |

There is deliberately **no tool** for cancel, confirm, reject, delete, mark-paid, approve-payment, or press-print. The capability simply does not exist in the toolset — that is a stronger guarantee than a prompt instruction.

### 3.4 KG Builder

Nightly batch over the previous day's conversations. Extracts entities, relations and Q&A pairs; see §6.

### 3.5 Knowledge Graph store

Neo4j (or Postgres + Apache AGE if you prefer one engine) for the graph, plus pgvector for embeddings over utterances and canonical answers. Hybrid retrieval: vector recall, then graph expansion.

### 3.6 Booking Adapter

A Playwright worker holding an authenticated session to the back-office.

Why a browser and not HTTP calls: the app is a legacy server-rendered PHP system with CSRF-bearing hidden fields, bootstrap-select widgets, and JS-driven totals. Replaying raw POSTs is brittle and dangerous — a malformed POST to the block-G endpoint could cancel a booking. A browser driving the real UI respects the app's own validation.

Hard requirements:

- Runs as a **single-concurrency queue**. Never two writes to the same booking at once.
- Per-block scoped selectors. The manage page DOM is ~900k characters; global selectors are unreliable and global text extraction returns the page's decorative chat widget instead of content. Resolve each form block first, then query inside it.
- Retry with wait-and-retry on render stalls — the page routinely freezes for several seconds after load. Never re-click on timeout.
- **Selector contract tests** run on a schedule against a known booking; if the DOM shifts, the adapter fails closed and alerts rather than clicking blind.
- Every action writes a before/after snapshot to the Audit Log.

### 3.7 Scheduler

- Every 15 min: sweep `/booking` filtered to `ใบสั่งซื้อใหม่(รอจ่ายเงิน)`, read `เหลือเวลา(ชม.)`, and push warnings at configurable thresholds (e.g. T-12h, T-4h, T-1h) into the group that owns the booking.
- Daily 08:00: digest per group — lapsing today, guarantee deadlines this week, bookings with missing traveller data.
- Weekly: departure reconciliation for codes with departures inside 30 days.

### 3.8 Approval Store & Audit Log

Staged writes live in the Approval Store with a TTL. A Flex message with Approve/Reject postback actions goes to the group. On `postback`, the worker verifies the approver is on the authorised list, replays the staged action, and logs it. Append-only audit: who asked, what was staged, who approved, what the adapter did, before/after values.

---

## 4. LINE channel setup checklist

Verified against the current docs. You must do these yourself — I won't create accounts or handle credentials.

**LINE Developers Console → your channel → Messaging API tab**

1. Issue a **channel access token v2.1** (user-specified expiration). Avoid long-lived tokens; if you must use one, restrict caller IPs under the **Security** tab.
2. Set **Webhook URL** to your HTTPS endpoint. Click **Verify** → expect Success. Enable **Use webhook**.
3. Enable **Webhook redelivery** — and make sure §3.1 dedupe is in place first.
4. Enable **Allow bot to join group chats**. *Off by default.* Without this the bot cannot be invited into any group.
5. Note the channel secret for signature verification. Store in the VPS secret store, never in the repo.

**LINE Official Account Manager**

6. Set **Greeting messages** → Disabled.
7. Set **Auto-reply messages** → Disabled. Both default to Enabled and will collide with your bot's replies.
8. Pursue **Verified or Premium** account status if you need `members/ids`.

**Per group**

9. Remove any existing Official Account (only one per group).
10. Invite the new OA. Capture the `join` event and register the `groupId` with a human-readable name and a role tag (`sales_ops`, `sales_agency`, `internal`).

### 4.1 Platform constraints that shape the design

| Constraint | Consequence |
|---|---|
| Reply tokens are **single-use and valid ~1 minute** | Use the reply token only for a fast acknowledgement ("กำลังตรวจสอบ…"). Deliver the real answer by **push**. Never hold a reply token across a browser-automation round trip. |
| **No API returns message text after the webhook** | The KG cannot be backfilled from LINE. It starts the day you go live. Seed it from manual chat exports if you have them. |
| Push to a group counts as **one message per member** | A push into a 25-person group consumes 25 messages of your plan quota. Batch alerts; prefer a daily digest over per-event pings. |
| Max **5 message objects** per reply/push request | Long answers must be chunked or delivered as a single Flex bubble. |
| **No multicast to groups** | Fan-out to N groups = N push calls. |
| `members/ids` is verified/premium only | Fall back to building the staff map from observed `source.userId` + `GET /v2/bot/group/{groupId}/member/{userId}` on first sighting. |
| User-sent media is auto-deleted after a period | Fetch attachments from `api-data.line.me/v2/bot/message/{id}/content` **immediately** on webhook, not lazily. |
| Rate limits use a token bucket; most endpoints 2,000 rps, narrowcast/broadcast 60/hr | Not a practical constraint here, but implement 429 backoff anyway. |

---

## 5. Conversation routing

### 5.1 When does the bot speak?

Groups are busy human channels; an over-eager bot destroys trust. Default policy:

| Situation | Behaviour |
|---|---|
| Message in a group, bot **@mentioned** | Respond. Detect via `message.mention.mentionees[].isSelf === true` |
| Message in a group starting with a command prefix (e.g. `/bk`, `#จอง`) | Respond |
| Message in a group, no mention, no prefix | **Silent.** Ingest only |
| 1:1 chat with the OA | Always respond |
| Postback (approval button) | Always process |
| High-confidence known question, no mention | Configurable. Start **off**; enable per group only after the KG is proven |

### 5.2 Intent model

Route to one of:

1. `lookup_booking` — "BK2026000379342 สถานะไหน"
2. `lookup_departure` — "GO2CTS4NCTSTG261205A มีกี่บุ๊ค เหลือที่นั่งเท่าไหร่"
3. `deadline_query` — "อันไหนใกล้หมดเวลา"
4. `amend_booking` — "เพิ่มผู้ใหญ่ 2 คนใน BK…"
5. `fill_pax_details` — passport/name data arriving as text or an image
6. `doc_request` — "ออกใบแจ้งหนี้ VAT 7%"
7. `faq` — answered from the KG
8. `lifecycle_request` — cancel/confirm/refund → **always escalate, never execute**
9. `chitchat` / `unclear` — clarify or stay silent

### 5.3 Answer shape

- Thai by default, mirroring the asker's register. Keep booking codes, tour codes and status labels verbatim in Thai — never translate `การันตี` or `ใบสั่งซื้อใหม่(รอจ่ายเงิน)`.
- Always cite the source: booking code and the timestamp the data was read. Countdowns move while you type, so quote the absolute lapse time, not "47 hours left".
- Flex bubbles for structured answers (booking card, departure card, approval card); plain text for FAQ.

---

## 6. Knowledge graph

### 6.1 What we are actually learning

Three distinct things, often conflated:

1. **FAQ knowledge** — recurring questions and the answers that ended the thread.
2. **Interaction patterns** — who asks whom, what ops needs from sales before acting, what sales needs from an agency before promising anything, and how long each hop takes.
3. **Process flow** — the real-world sequence, which usually differs from the documented one. E.g. *agency asks to hold seats → sales checks allotment → ops confirms → sales quotes deadline → agency pays → ops verifies slip → ops flags paid → sales confirms.*

### 6.2 Node and relationship schema

**Nodes**

| Label | Key properties |
|---|---|
| `Person` | `line_user_id`, `display_name`, `role` (`sales`/`ops`/`agency`/`finance`), `org` |
| `Org` | `name`, `type` (`wholesale`/`agency`), `b2b_agent_id` |
| `Group` | `line_group_id`, `name`, `kind` (`sales_ops`/`sales_agency`) |
| `Conversation` | `id`, `group_id`, `started_at`, `ended_at`, `participants[]` |
| `Utterance` | `id`, `text_redacted`, `ts`, `speaker`, `embedding` |
| `Question` | `canonical_text`, `intent`, `frequency`, `embedding` |
| `Answer` | `canonical_text`, `confidence`, `source` (`observed`/`curated`), `verified_by` |
| `Topic` | `name` (visa, deposit, VAT, rooming, seat-release, name-change…) |
| `Booking` | `code`, `tour_code`, `status_last_seen` |
| `Departure` | `tour_code`, `depart_date`, `allotment` |
| `FlowStep` | `name`, `actor_role`, `precondition`, `output` |
| `Policy` | `statement`, `source_utterance`, `confirmed` |

**Relationships**

```
(Person)-[:MEMBER_OF]->(Group)
(Person)-[:WORKS_FOR]->(Org)
(Utterance)-[:IN]->(Conversation)-[:IN]->(Group)
(Utterance)-[:SPOKEN_BY]->(Person)
(Utterance)-[:QUOTES]->(Utterance)
(Utterance)-[:INSTANCE_OF]->(Question)
(Question)-[:ANSWERED_BY {support, avg_latency_min}]->(Answer)
(Question)-[:ABOUT]->(Topic)
(Answer)-[:CITES]->(Policy)
(Conversation)-[:CONCERNS]->(Booking)
(Booking)-[:ON]->(Departure)
(Person)-[:ASKS {count, median_latency_min}]->(Person)
(FlowStep)-[:PRECEDES {observed_count}]->(FlowStep)
(FlowStep)-[:PERFORMED_BY]->(Person)
(Policy)-[:CONTRADICTS]->(Policy)
```

`(Person)-[:ASKS]->(Person)` with counts and latencies is what encodes "how sales interacts with operations" in a queryable way. `(FlowStep)-[:PRECEDES]->` mined across many conversations is what encodes the flow.

### 6.3 Extraction pipeline (nightly)

1. **Segment** — group raw messages into `Conversation` nodes.
2. **Resolve entities** — regex for booking codes (`BK\d{13}`) and tour codes (`GO2[A-Z0-9]+`); link to `Booking` / `Departure`. Map speakers to `Person`, creating on first sighting.
3. **Classify utterances** — question / answer / instruction / status-update / social.
4. **Mine Q&A pairs** — a question followed within the conversation by an answer from a different role, where the thread then ends or the asker acknowledges. Acknowledgement in Thai ops chat is usually `ได้ค่ะ`, `รับทราบ`, `โอเค`, `ขอบคุณค่ะ` — treat these as weak positive labels.
5. **Cluster into canonical questions** — embed, cluster, pick a representative, count frequency.
6. **Synthesise canonical answers** — for each cluster, summarise the observed answers into one answer plus a confidence derived from support count and consistency. Conflicting answers produce **no** canonical answer; they raise a review item.
7. **Mine policies** — statements of rule ("มัดจำ 5,000 ต่อท่าน", "ยกเลิกหลังออกตั๋วยึดเต็มจำนวน"). Every policy starts `confirmed = false`.
8. **Mine flow** — order role-tagged steps within conversations; aggregate `PRECEDES` counts across conversations to get the dominant path.
9. **Detect drift** — a canonical answer whose recent support diverges from its historical support is flagged; policies change and stale answers are worse than none.

### 6.4 Curation gate

The agent must never present a mined answer as authoritative without human sign-off. Three tiers:

| Tier | Source | Agent behaviour |
|---|---|---|
| **Curated** | Human-approved answer or policy | State it directly |
| **Observed (high support)** | ≥5 consistent instances, no contradictions | State it, labelled "จากที่เคยตอบกันมา" |
| **Observed (low support / conflicting)** | <5 instances or contradictions present | Do not answer. Escalate, and optionally show what was observed |

Build a small review UI (or a LINE-based review flow) where an ops lead promotes Observed → Curated. Without this gate the graph will happily teach the bot someone's one-off mistake.

### 6.5 Retrieval at answer time

```
1. Embed the incoming question → vector search over Question + Utterance
2. Take top-k → expand in graph: ANSWERED_BY, ABOUT, CITES
3. If the question names a booking/tour code → also pull live data via booking.* tools
4. Rank by: tier (curated > observed) × recency × support × group-kind match
5. Compose: live facts first, KG pattern second, citation always
```

Group-kind match matters: the correct answer to an agency in a `sales_agency` group is often a subset of the internal answer in a `sales_ops` group. **Never leak internal margin, cost, or commission figures into an agency-facing group.** Enforce this as a hard filter on the response path keyed on `Group.kind`, not as a prompt instruction.

---

## 7. Booking action layer

### 7.1 Read paths (safe, unattended)

Reuse the site spec from [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md). Each maps to one adapter method:

| Tool | Route | Notes |
|---|---|---|
| `booking.find` | `/booking` + `คำค้นหา` | Matches program name, tour code, booking code, traveller name |
| `booking.get` | `/booking/manage/{id}` | Resolve blocks first, then read per block |
| `booking.countdown` | `/booking` + status filter, expand rows | Read `เหลือเวลา(ชม.)` |
| `booking.by_tour_code` | `/booking` + `รหัสทัวร์` | Returns allotment, booking count, pax total |
| `booking.missing_fields` | `/booking`, scan `ข้อมูลผู้เดินทางไม่ครบ` badges | Tags name the missing fields |
| `booking.queues` | `/booking/request_cancel`, `/booking/late_approval`, `/booking/payment_notification` | Read-only summaries |
| `booking.seats` | `/report/report_seat` | Reconciliation |

### 7.2 Two countdown mechanics — get this right

| Status | Field | Format | Origin |
|---|---|---|---|
| `ใบสั่งซื้อใหม่(รอจ่ายเงิน)` | `เหลือเวลา(ชม.)` | `47:57 (20/09/2026 10:18)` | booking time + `จัดการชั่วโมงคำสั่งซื้อ` (currently 48h) |
| `การันตี` | badge under tour code | `ชำระภายใน 26/08/2026` + `เหลืออีก 78 วัน` | guarantee deadline |

For guaranteed bookings `เหลือเวลา(ชม.)` reads `-`. An alerting system that only watches the hours field will silently miss every guaranteed booking. Watch both.

### 7.3 Write paths — staged, approved, narrow

Permitted, with approval:

| Action | Block | Approval card must show |
|---|---|---|
| Add pax | C (`รายละเอียดการจอง`, `+` stepper) | Booking code, occupancy line, old → new pax, old → new total, remaining allotment |
| Fill traveller details | B (`ผู้ใช้บริการ/ลูกค้า`) | Row index, field-by-field diff |
| Stage ad-hoc charge | D (`เพิ่ม/ลดราคา`) | Charge type, direction, amount, per-pax vs per-booking, resulting balances |
| Configure VAT document | H (`ปริ้นใบสั่งจอง`) | Bill header, entity, branch, **which single VAT rate**, which document — then stop; a human presses print |

### 7.4 Prohibited — not implemented as tools at all

| Prohibited | Control it would touch |
|---|---|
| Delete a traveller | `เลือกลบลูกค้า` / `เลือกลบลูกค้าทั้งหมด` + block-B Save |
| Reduce headcount | block-C `−` stepper |
| Cancel | status → `ยกเลิกการสั่งซื้อ` + block-G Save |
| Confirm | status → `ยืนยันแล้ว(อนุมัติการขาย)` + block-G Save |
| Reject | status → `ปฏิเสธ(ไม่อนุมัติการขาย)` + block-G Save |
| Mark paid | `ชำระเงินครบถ้วนแล้ว` checkbox |
| Authorise travel | `อนุญาตให้เดินทางได้` checkbox |
| Submit cancel request | `ส่งคำขอ` |
| Move the deadline | `จัดการชั่วโมงคำสั่งซื้อ` Save |
| Claim the order | `ขอดูแลใบสั่งจองนี้` |
| Approve a payment | `/booking/payment_notification` actions |
| Issue final document | print buttons in block H |

Two structural notes worth repeating to whoever builds this:

- **There is no "delete booking" function anywhere in the back-office.** Cancellation is a *status change* on block G, not a delete button. The guard therefore lives on the status dropdown and its Save, and the safest guarantee is that no tool in the Hermes toolset can reach block G at all.
- **The nine-forms-one-page layout makes every Save wider than it looks.** A stray Save commits its entire block. The adapter must set up exactly one block, verify nothing else in that block changed, then Save — and it never presses a Save it did not itself stage.

---

## 8. Open items to specify next

These are placeholders the draft references but does not yet define; pin them down before build.

- **§8.1 Normalised message schema** — the canonical fields the Ingest Worker persists per event (event id, group id, speaker id, ts, type, redacted text, raw ref, quoted id, attachment refs).
- **PII redaction spec** — exact patterns for passport, national ID, phone, card fragments, and the raw/redacted storage split.
- **Authorised-approver list** — who may approve staged writes per group, and how it is maintained.
- **Retention & PDPA** — retention windows for raw vs redacted corpus, unsend handling, and audit-log retention (ties to assumption A6).
- **Secret storage** — where the channel secret, access token, and back-office service-account credentials live on the VPS.
