# Stratemark Research Data

The language for distinguishing local BYOK research from user-owned cloud research artifacts.

## Language

**Cloud Deck**:
A user-owned, persisted research artifact containing deck metadata, market scope, populated cards, citations, research state, and refresh timestamps. Cloud Decks are stored in the cloud and are the source of truth for the cloud engine.
_Avoid_: Cloud snapshot, cloud cache

**BYOK Research**:
Research performed with the user's own Gemini key and retained in the user's local browser or desktop storage. BYOK Research is not automatically synchronized to the cloud.
_Avoid_: Free research, local deck

**Cloud Deck Owner**:
The authenticated Firebase user identified by a server-verified Firebase UID. A Cloud Deck has exactly one owner; anonymous callers, demo tokens, and unverified bearer strings are not owners.
_Avoid_: Caller, account token, session user

**Cloud Persistence Boundary**:
The Cloud Run service is the only application boundary allowed to access cloud research data. The browser calls authenticated API endpoints; it does not read or write the top-level Firestore collections directly.
_Avoid_: Direct Firestore sync, browser-owned cloud data

**Cloud Deck Aggregate**:
A Cloud Deck and its plan, cards, citations, research state, ownership, and timestamps are read and written as one logical record. Generated images are not part of the aggregate.
_Avoid_: Deck row, deck plus child records

**Partial Cloud Deck**:
A Cloud Deck whose research is still running or was interrupted. Its completed cards may be viewed as progress, but it is not eligible for final reports, rankings, or autonomous refresh until its state is `ready`.
_Avoid_: Complete deck, failed deck

**Watched Cloud Deck**:
A `ready` Cloud Deck whose owner explicitly enables autonomous refresh with a chosen cadence. Only Watched Cloud Decks enter the scheduler's worklist.
_Avoid_: Auto-refreshing deck, scheduled-by-default deck

**Cloud Entitlement**:
An active, server-trusted subscription tier attached to the authenticated Firebase user. It authorizes Cloud Deck storage and server-paid research; a service token authorizes scheduled work but does not represent a user.
_Avoid_: Login status, app-token user, client-side Pro flag

**Market Scope**:
A reusable, owner-scoped definition of the market being researched, including its name, vertical, geography, notes, and search themes. A Cloud Deck stores a historical snapshot of its Market Scope for reporting.
_Avoid_: Prompt, query string, live market definition

**Provenance Gate**:
The rule that research output must pass citation, confidence, unknown-value, vice-claim, and signal-metric integrity checks before a Cloud Deck can become `ready`. Unsupported output cannot be presented as completed research.
_Avoid_: UI validation, model trust, best-effort validation

**Cloud Deck Visibility**:
A Cloud Deck is private to its owner unless the owner explicitly creates a separate, revocable, read-only sharing capability. Firestore documents are never public merely because a share link exists.
_Avoid_: Public deck, link-only security

**Cloud Deck Deletion**:
Deleting a Cloud Deck removes its persisted aggregate and share capabilities without deleting a reusable Market Scope that other decks reference. Market cleanup is separate from deck deletion.
_Avoid_: Cascade delete, delete-all deck data

**Cloud Deck Concurrency**:
Writes to one Cloud Deck are versioned. A writer may update only the revision it read; stale writes are rejected so a newer user action or refresh cannot be silently overwritten.
_Avoid_: Blind overwrite, implicit merge

**Idempotent Cloud Creation**:
A retry of one owner's deck-creation operation resumes or returns the same Cloud Deck instead of creating a duplicate. Reusing its identity for another owner or incompatible Market Scope is rejected.
_Avoid_: Duplicate-on-retry, request replay as new deck

**Cloud Artifact**:
A generated image or other large binary associated with a Cloud Deck, stored privately outside Firestore and referenced by metadata in the Cloud Deck aggregate.
_Avoid_: Embedded image, Firestore blob

**Entitlement-Lost Cloud Deck**:
A retained Cloud Deck whose owner no longer has an active Cloud Entitlement. It remains readable and exportable during the retention period, but cannot start paid research or autonomous refresh.
_Avoid_: Deleted-on-cancel deck, free cloud deck

**Cloud Retention Period**:
The 30-day read-only period after Cloud Entitlement ends. At its end, the owner's Cloud Decks and Cloud Artifacts are deleted after advance notice; local BYOK data is unaffected.
_Avoid_: Grace forever, immediate purge

**Cloud Persistence Model**:
Cloud Run owns the top-level `decks`, `markets`, and `saved_cards` collections. The browser accesses them only through authenticated API endpoints; the collections are not a client synchronization surface.
_Avoid_: Per-user snapshot sync, direct Firestore client store

**Refresh Progress**:
Progress from a refresh of an existing `ready` Cloud Deck is temporary until the complete result passes the Provenance Gate. The previous ready aggregate remains authoritative for reports while refresh progress is visible separately.
_Avoid_: Partial replacement, last-result-wins refresh

**Server Version Authority**:
Cloud Run and Firestore control Cloud Deck timestamps and revision increments. Clients may provide an expected revision for a conditional write but cannot provide ordering timestamps or revisions.
_Avoid_: Client clock ordering, client-assigned revision

**Scheduler Identity**:
A dedicated Google service account authenticated with an OIDC identity token may run autonomous refreshes. It is an execution identity, not a Cloud Deck owner or Firebase user.
_Avoid_: Scheduler user, scheduler-owned deck, shared user token

**Scheduled Entitlement Check**:
Before refreshing a Watched Cloud Deck, the scheduler verifies that its owner still has an active Cloud Entitlement. Expired owners retain their data during the Cloud Retention Period but are skipped and given an explicit reason.
_Avoid_: Refresh-by-old-claim, entitlement-blind scheduler

**Cloud Usage Quota**:
New Cloud Deck creation consumes an owner's deck quota. Refreshing an existing Watched Cloud Deck uses a separate bounded refresh allowance; failed operations and idempotent retries do not count twice.
_Avoid_: Every retry counts, global-only quota

**Cloud Report**:
A report or export is derived from the latest validated `ready` revision of a Cloud Deck. A cached report is a Cloud Artifact tied to the revision it represents and is never the source of research truth.
_Avoid_: Mutable report source, unversioned PDF cache

**BYOK Promotion**:
An explicit owner action that copies selected local BYOK research into a new Cloud Deck after entitlement is available. Promotion never uploads an API key and preserves only the selected research data and provenance.
_Avoid_: Automatic migration, background upload

**Saved Card Bookmark**:
An owner-scoped reference to a stable card ID, its Cloud Deck, and the deck revision at which it was saved. It may retain a display snapshot, but the Cloud Deck remains the authoritative card source.
_Avoid_: Independent saved card, copied card authority

**Research Trace**:
The persisted execution record for resumable Cloud research: stage, completed work, cursor, status, errors, timestamps, and validated cards/citations. It excludes API keys, authorization headers, and unnecessary full model transcripts.
_Avoid_: Prompt archive, raw agent transcript

**Owner-Private Lookup**:
An API lookup that reveals only records owned by the verified caller. Missing records and records owned by another user have the same 404 response, preventing existence enumeration.
_Avoid_: Forbidden-but-visible, cross-owner lookup

**Cloud Deck Schema Version**:
The explicit version of a persisted Cloud Deck aggregate. Cloud Run migrates known older versions to the current version and rejects unknown future versions without presenting them as valid research.
_Avoid_: Heuristic compatibility, unversioned record

**Cloud Persistence Failure**:
An unavailable or failed Firestore operation in production. Cloud operations return an explicit failure and do not fall back to process memory; memory persistence is an explicit local-development/test mode only.
_Avoid_: Silent memory fallback, success-that-disappears

**Cloud Aggregate Commit**:
The atomic write of a Cloud Deck and its reusable Market Scope. Both records commit together only after owner checks; a failed or conflicting write commits neither record.
_Avoid_: Partial deck/market commit, eventual owner check

**Cloud Aggregate Size Limit**:
A Cloud Deck must fit within the Firestore aggregate-size boundary. Oversized writes fail explicitly and preserve the previous valid revision; Cloud Storage is used only for genuinely large binary Cloud Artifacts.
_Avoid_: Truncated deck, silent split aggregate

**Cloud Creation Reservation**:
The single quota reservation made when an idempotent Cloud Deck creation is first accepted. Retries reuse it; infrastructure failure may release it, while work that ran and failed provenance remains charged once.
_Avoid_: Per-retry charge, ready-only accounting

**Cloud Deck Lifecycle**:
`running` means initial research is active, `partial` means interrupted initial research with visible progress, `ready` means a complete Provenance-Gated result, `refreshing` means progress alongside an existing ready result, and `failed` means no valid result exists. A failed refresh leaves the deck `ready` with refresh-error metadata.
_Avoid_: Failed-ready deck, partial-as-ready

**Cloud Deck Recovery**:
An interrupted initial Cloud Deck resumes from its persisted Research Trace and stable card IDs. A changed Market Scope or plan starts a new Cloud Deck rather than mutating the old partial operation.
_Avoid_: Duplicate-on-resume, changed-plan continuation

**Current Cloud Revision**:
The single latest `ready` revision retained for a Cloud Deck. Older revisions are not authoritative; saved bookmarks may retain a display snapshot when their referenced revision is no longer available.
_Avoid_: Implicit revision history, unbounded deck history

**Offline Cloud Cache**:
A local read-only copy of the last fetched Cloud Deck revision. It may be shown with an explicit stale/offline marker, but local edits are not cloud writes and cannot claim persistence until Cloud Run confirms them.
_Avoid_: Offline sync, optimistic cloud save

**BYOK Cloud Compute**:
An optional Cloud Run request paid for with the caller's own Gemini key. It returns a non-persisted result for local handling and cannot create or mutate Cloud Decks, Markets, bookmarks, schedules, or Cloud Artifacts.
_Avoid_: BYOK cloud sync, BYOK-owned Firestore data

**Cloud Share Capability**:
A read-only, revocable capability represented by a random opaque token whose hash is stored with its owner, Cloud Deck, permissions, creation time, and optional expiry. It grants no mutation, refresh, or cross-owner access.
_Avoid_: Public Firestore link, bearer deck access

**Stable Card Identity**:
The deterministic identity of a card derived from its Cloud Deck, canonical entity, and facet/card type. It is independent of array position and remains stable while refreshes update or retire the card.
_Avoid_: Array-index card ID, per-refresh card identity

**Validated Partial Card**:
A card persisted during incomplete research that has already passed the same provenance checks required of a `ready` card. Partial status means incomplete coverage, not weaker evidence standards.
_Avoid_: Raw partial card, untrusted progress card

**Human Card Verification**:
The owner-only action that sets or clears `user_verified` on a card. Automated research, refreshes, migrations, and promotion may preserve the value but cannot change it.
_Avoid_: Agent verification, inferred user approval

**Cloud Deck Owner Edit**:
An owner may change display metadata and refresh settings, and may perform Human Card Verification. Cards, metrics, citations, Market Scope, and Research Trace state are not directly editable; scope or plan changes create a new Cloud Deck.
_Avoid_: Fact editing, plan mutation, user-authored research

**Cloud Deck Creation Operation**:
The asynchronous operation that populates a Cloud Deck. It creates a stable `running` deck identity first, then a worker persists validated progress and transitions the deck through its lifecycle independently of the initiating HTTP request.
_Avoid_: Request-bound research, synchronous-only creation

**Cloud Research Worker**:
The authenticated Cloud Run worker invoked by Cloud Tasks to execute or resume a Cloud Deck Creation Operation. It reads Firestore trace state, writes validated progress, and is safe to retry for the same deck identity.
_Avoid_: Browser worker, scheduler-owned research

**Refresh Fan-out**:
The scheduler behavior that discovers eligible Watched Cloud Decks and enqueues one independent Cloud Task per deck. The scheduler does not execute deck research inline.
_Avoid_: Monolithic refresh job, scheduler-bound deck work

**Research Checkpoint**:
A per-card or bounded-unit Cloud Deck progress commit containing the validated progress, stable card identity, cursor, and lifecycle metadata. Repeating the latest checkpoint during a retry is safe and does not duplicate work.
_Avoid_: Stage-only checkpoint, unbounded progress log

**Owner Data Purge**:
A durable deletion operation that revokes an owner's share capabilities, cancels queued work, removes all owner-scoped Cloud Decks, Markets, bookmarks, Research Trace, and Cloud Artifacts, and verifies completion. It is distinct from subscription cancellation.
_Avoid_: Deck-only deletion, cancellation purge

**Deck Snapshot Share**:
The limited share view containing a Cloud Deck's historical Market Scope snapshot and current ready result. It excludes live Market data, other decks, owner metadata, Research Trace, refresh settings, and unseparately-authorized Cloud Artifacts.
_Avoid_: Market share, account share, live-scope share

**Entitlement Stop Point**:
The safe boundary at which a running Cloud Research Worker re-checks Cloud Entitlement. If entitlement ends, the worker may finish the current bounded unit, persist validated partial progress, and stops all further model work.
_Avoid_: Mid-request unlimited spend, abrupt uncheckpointed abort

**Deletion Revocation**:
An owner deletion revokes queued and running Cloud Research Worker authority. Workers that observe the deletion state stop without writing or recreating the Cloud Deck; retries become harmless no-ops.
_Avoid_: Finish-after-delete, resurrection on retry

**Immutable Cloud Ownership**:
The verified Firebase UID owning a Cloud Deck or Market Scope cannot be reassigned. Ownership transfer requires an explicit copy/promotion that creates a new identity for the new owner.
_Avoid_: Mutable owner UID, transfer by share link

**Cloud Cache Deletion**:
After confirmed Cloud Deck deletion or retention expiry, the browser removes the matching cached cloud data and artifacts while preserving unrelated BYOK data. Offline clients mark the cache pending deletion and never present it as current cloud data.
_Avoid_: Deleting all local research, offline resurrection

**Stale Cloud Evidence**:
Previously validated research whose source cannot currently be revalidated. It retains its citation and last value with explicit freshness/error state; it is never guessed, zero-filled, or silently presented as fresh.
_Avoid_: Replaced-with-zero, silently fresh evidence

**Persistence Delivery Slices**:
The first slice establishes verified identity, entitlement, owner-scoped Firestore persistence, lifecycle checkpoints, versioned writes, and stale-cache behavior. Worker execution, scheduler fan-out, Cloud Artifacts, sharing, retention, and purge follow as dependency-ordered slices.
_Avoid_: Persistence-only without identity, all-at-once rollout

**Cloud Entitlement Record**:
The server-owned `entitlements/{uid}` record written by the billing system and read by Cloud Run to authorize Cloud operations. Firebase custom claims may mirror its status for display but are not the authorization source.
_Avoid_: Email entitlement, client-only Pro flag, stale claim authority

**Semantic Memory**:
Structured, scoped facts distilled from a long research conversation after the agreed turn threshold, retaining supporting citations and replacing most old conversational context while preserving a small recent window.
_Avoid_: Raw chat replay, unbounded conversation context

**Judging Build**:
The hackathon artifact with the preview access-code gate removed. It permits the shared active-Pro Firebase account to exercise persisted Cloud Deck behavior while server-side authentication, entitlement, rate, and spend controls remain enforced.
_Avoid_: Paywall build, anonymous persistent cloud
