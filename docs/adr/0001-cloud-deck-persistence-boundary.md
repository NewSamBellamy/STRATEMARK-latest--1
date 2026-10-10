---
status: accepted
---

# Cloud Deck Persistence Boundary

Cloud Decks use service-owned top-level Firestore collections (`decks`, `markets`, and `saved_cards`) rather than browser-owned per-user snapshots. Cloud Run is the only application boundary allowed to access them; it verifies Firebase UIDs, enforces entitlement and ownership, stores complete deck aggregates, and exposes data through authenticated API endpoints. We chose this over direct Firebase client sync so scheduled research and persistence share one trusted server boundary; the trade-off is that the API must own auth, authorization, concurrency, and retention.

## Consequences

- Every persisted record carries a verified owner UID and is filtered by that UID.
- Firestore client rules deny direct browser access to the service-owned collections.
- The old `users/{uid}/**` whole-snapshot model is not the Cloud Deck model.
- Cloud Deck writes require provenance validation and version checks.
