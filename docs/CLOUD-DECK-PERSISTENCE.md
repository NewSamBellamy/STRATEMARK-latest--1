# Cloud Deck Persistence

## Problem Statement

Stratemark's Cloud Engine currently returns research results through Cloud Run,
but the populated deck is not a durable cloud record. Process-local state
disappears when Cloud Run restarts or scales between instances, scheduled work
cannot reliably find decks, and the browser cannot distinguish a persisted
Cloud Deck from a local cache. The old planning notes also describe a different
per-user snapshot model than the service-owned model selected for the
hackathon.

## Solution

Make Cloud Run the sole application boundary for Cloud Deck persistence. A
verified Firebase user with an active Cloud Entitlement can create and operate
owner-scoped Cloud Decks backed by top-level Firestore collections. The browser
uses authenticated API endpoints and may retain a clearly labelled local cache,
but never accesses Firestore directly.

Cloud Deck creation is asynchronous and idempotent. Cloud Run creates a stable
`running` record, queues a Cloud Tasks operation, and returns the deck identity.
The worker checkpoints validated progress, resumes after interruption, and
promotes a complete result to `ready`. An interrupted initial run is `partial`;
an interrupted refresh preserves the last `ready` result and exposes refresh
progress separately. Cloud Scheduler discovers explicitly watched decks and
fans out one OIDC-authenticated task per deck.

## User Stories

1. As an entitled Firebase user, I want to create a Cloud Deck, so that my research survives browser refreshes and Cloud Run restarts.
2. As an entitled Firebase user, I want a stable deck identity returned immediately, so that I can follow a long-running research operation without holding an HTTP request open.
3. As an entitled Firebase user, I want a timed-out creation retry to resume the same operation, so that one request cannot create duplicate decks.
4. As an entitled Firebase user, I want interrupted research to remain visible as partial progress, so that I can see what work completed.
5. As an entitled Firebase user, I want partial cards to be labelled as incomplete coverage, so that I do not mistake them for a finished deck.
6. As an entitled Firebase user, I want only a complete provenance-safe result to become ready, so that unsupported model output is not presented as finished research.
7. As an entitled Firebase user, I want a failed refresh to leave the last ready result intact, so that a temporary source or infrastructure failure does not destroy trustworthy data.
8. As an entitled Firebase user, I want to opt a ready deck into refresh with a cadence, so that autonomous research reflects my intent and budget.
9. As an entitled Firebase user, I want watched decks refreshed independently, so that one slow or failed deck does not block other decks.
10. As an entitled Firebase user, I want stale source evidence marked explicitly, so that an old cited value is not mistaken for a fresh value.
11. As an entitled Firebase user, I want reports generated from the current ready revision, so that an export cannot silently describe a newer or older dataset.
12. As an entitled Firebase user, I want saved cards to track their deck revision, so that bookmarks remain meaningful when a deck refreshes.
13. As an entitled Firebase user, I want to see only my own decks, markets, cards, bookmarks, and entitlement data, so that another user's research remains private.
14. As an entitled Firebase user, I want another user's deck ID to look nonexistent, so that record existence cannot be enumerated.
15. As an entitled Firebase user, I want metadata and refresh settings editable without editing facts, so that presentation changes cannot corrupt research provenance.
16. As an entitled Firebase user, I want to mark a card as user-verified, so that only my explicit human action changes that status.
17. As a BYOK user, I want local research to remain local, so that my Gemini key and local research are never uploaded automatically.
18. As a BYOK user, I want optional Cloud Run compute using my own key, so that I can use server capabilities without receiving cloud persistence or accidentally syncing data.
19. As an entitled Firebase user, I want a selected local deck explicitly promoted to the cloud, so that migration is deliberate and never uploads my key.
20. As a user whose entitlement ends, I want my Cloud Decks retained read-only for 30 days, so that a stale billing claim does not immediately destroy my work.
21. As a user whose entitlement ends, I want paid research and autonomous refresh stopped, so that the service does not spend after cancellation.
22. As an account owner, I want all my cloud records and artifacts purged on request, so that account deletion is complete and verifiable.
23. As a shared-deck recipient, I want a read-only deck snapshot, so that sharing does not expose live market data or owner records.
24. As a hackathon judge, I want the judging build to have no preview access-code gate, so that the product does not appear paywalled.
25. As a hackathon judge using the supplied active-Pro Firebase account, I want to exercise the persisted Cloud Deck path, so that the durable agent architecture is demonstrable.
26. As a maintainer, I want Cloud Run to fail explicitly when Firestore is unavailable, so that a successful response never disappears on process restart.
27. As a maintainer, I want each persisted record versioned, so that schema changes are explicit and unknown future data is not guessed into validity.
28. As a maintainer, I want Cloud Tasks and Scheduler calls authenticated with Google service identities, so that service execution cannot impersonate an end user.

## Implementation Decisions

- The highest application seam is `CloudDeckService`. It owns verified identity,
  entitlement, ownership filtering, lifecycle transitions, idempotency,
  provenance validation, concurrency, quota reservation, and persistence
  orchestration. HTTP routes, Firestore, Firebase Auth, Cloud Tasks, and the
  research engine are adapters around that seam.
- Firestore uses service-owned top-level collections: `decks`, `markets`,
  `saved_cards`, and `entitlements`. Every user-owned record carries an
  immutable verified Firebase UID. Firestore is not a direct browser sync
  surface.
- Cloud Run verifies Firebase ID tokens and never treats a raw bearer string,
  app token, email, or demo token as a user identity. A non-owner lookup returns
  the same 404 as a missing record.
- A server-owned `entitlements/{uid}` record is authoritative for active Cloud
  Entitlement. Firebase custom claims may mirror status for display but do not
  authorize Cloud operations.
- A Cloud Deck is an atomic aggregate containing metadata, Market Scope
  snapshot, populated validated cards and citations, Research Trace, lifecycle
  state, owner UID, revision, and server timestamps. Generated images and other
  large binaries are Cloud Artifacts outside the aggregate.
- A Market Scope is reusable and owner-scoped. A deck keeps a historical scope
  snapshot, so later Market Scope edits do not rewrite historical reports.
- Lifecycle states are `running`, `partial`, `ready`, `refreshing`, and
  `failed`. A failed refresh leaves the current deck `ready` with refresh-error
  metadata. Only a complete result passing the Provenance Gate is `ready`.
- Initial creation and refresh are asynchronous Cloud Research Worker
  operations. Cloud Tasks invokes a private Cloud Run worker with OIDC and
  bounded retries. Cloud Scheduler only discovers eligible watched decks and
  enqueues per-deck tasks.
- Initial operations checkpoint each validated card or bounded unit with a
  cursor and progress metadata. Stable deterministic card IDs make checkpoint
  retries safe. Changed Market Scope or plan creates a new deck.
- A ready deck's refresh progress never replaces its current ready aggregate
  until the complete result passes validation. Only the current ready revision
  is retained initially; bookmarks may retain a display snapshot.
- Writes use server-controlled timestamps, monotonic revisions, expected
  revision preconditions, and atomic deck/market batches. Stale writes are
  rejected. Oversized aggregate writes fail without truncation or silent
  splitting.
- Creation is idempotent per owner and stable deck identity. Replays reuse the
  existing operation and quota reservation; another owner or incompatible plan
  cannot reuse the identity.
- Every partial and ready card passes the Provenance Gate. Verified metrics need
  usable citations, unsupported numbers are unknown/null, unsourced vice claims
  are omitted, and signal cards do not inherit entity metrics. Only an explicit
  human owner endpoint may change `user_verified`.
- The production service fails closed with an explicit 503 when Firestore is
  unavailable. Memory persistence exists only through an explicit local test or
  development mode.
- The browser may show a stale local Cloud Deck cache with its last-synced
  revision and timestamp. Offline edits cannot claim cloud persistence and are
  not queued as implicit sync.
- BYOK compute may use Cloud Run with the caller's own key, but it cannot create
  or mutate cloud records, schedules, bookmarks, or Cloud Artifacts.
- Owner deletion removes the deck and share capabilities without deleting a
  reusable Market Scope used by another deck. Account deletion is a durable
  full owner purge. Entitlement loss retains data read-only for 30 days, then
  purges after notice.
- Explicit sharing uses a random opaque token stored only as a hash. It grants
  read-only access to a deck snapshot, never live Market data, other decks,
  owner metadata, refresh settings, or mutation.
- The judging build removes the preview access-code gate. The shared active-Pro
  Firebase account is used for the persisted Cloud Deck demonstration; no
  credentials are committed to the repository or frontend source.
- The TypeScript implementation uses strict Zod contracts and native
  `@google/genai` response schemas at structured agent boundaries. A Python
  Pydantic service is not introduced solely for checklist wording.
- Semantic Memory is a later slice: after 20 conversation turns, strict
  structured facts with citations replace most old prompt history while a
  small recent window and the local audit record remain.

## Testing Decisions

- Tests assert external behavior at the `CloudDeckService` seam and HTTP
  boundary, not private Firestore calls or implementation-specific maps.
- Auth tests cover missing/invalid Firebase tokens, verified UID extraction,
  owner filtering, 404 anti-enumeration, immutable ownership, and scheduler
  OIDC identity separation.
- Entitlement tests cover active, expired, canceled, stale-claim, and missing
  entitlement records. Paid operations must fail before model work when not
  entitled.
- Persistence tests use an in-memory adapter for deterministic unit tests and
  the Firestore emulator for transaction, batch, query, size, and security-rule
  behavior where available.
- Lifecycle tests cover creation, partial checkpoints, resume, ready promotion,
  failed initial creation, refreshing with a preserved ready result, and failed
  refresh recovery.
- Concurrency tests cover stale revision rejection, server timestamps, atomic
  deck/market commits, idempotent retries, owner collisions, and deletion races.
- Provenance tests cover verified citations, unknown/null values, omitted
  unsourced vice claims, isolated signal metrics, and human-only
  `user_verified` changes.
- Worker tests cover Cloud Tasks retry idempotency, bounded checkpoints,
  entitlement checks, deletion revocation, and scheduler fan-out isolation.
- API tests cover Cloud Deck CRUD, saved-card revision resolution, stale-cache
  responses, explicit 503 persistence failures, and report revision binding.
- Existing research tests remain the prior art for Zod/response-schema and
  provenance behavior. Existing repository and API tests should continue to run
  through the recursive workspace test command.
- The hackathon build must be verified with `pnpm check`, a deployed health
  request, an authenticated deck creation, a Cloud Run restart/re-read, and a
  visible Cloud Console or `.run.app` recording.

## Out of Scope

- Direct browser access to Firestore or Firebase client-side Cloud Deck sync.
- Anonymous durable Cloud Decks and public full-persistence demo accounts.
- Automatic migration of all local BYOK data.
- Full immutable deck revision history in the first implementation.
- Committing, embedding, or logging any API key, Firebase credential, app
  token, scheduler token, or shared test credential.
- Full Cloud Storage artifact delivery, explicit sharing, 30-day purge jobs,
  account deletion, and Semantic Memory distillation in the first persistence
  slice; these remain dependency-ordered follow-up slices.
- A literal Python/Pydantic rewrite of the TypeScript research engine.
- New visual design or component restructuring.

## Further Notes

- The current repository has an authenticated `gcloud` CLI for project
  `stratemark-agentic`; Firebase CLI is not installed locally.
- The existing deployment and handover documents describe Firestore as future
  work and use a conflicting per-user snapshot model. They must be updated to
  reference this ADR and spec before the persistence implementation is treated
  as complete.
- The shared-Pro-only judging choice knowingly leaves the stricter “brand-new
  guest can execute cloud generation” checklist interpretation unsatisfied.
  The judging build can remove the preview code gate, but Firebase sign-in and
  active entitlement remain required for durable Cloud Deck persistence.
