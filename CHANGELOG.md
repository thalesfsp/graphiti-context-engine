# Changelog

## [1.0.1] - 2026-05-07

### Changed
- Make `afterTurn()` schedule Graphiti claim extraction/ingestion in the background instead of awaiting it on the reply path.
- Keep heartbeat turns from scheduling background ingestion.
- Keep `compact()` safe by waiting for any scheduled background drain before synchronously draining queued messages.

### Tests
- Updated engine/integration tests to assert `afterTurn()` returns quickly and queued messages drain asynchronously.

## [1.0.0] - 2026-03-08

### Added
- Phase 1: Core claim extraction pipeline
  - Lightweight ingest() hook
  - Async afterTurn() extraction
  - Hybrid assemble() retrieval
  - Legacy compact() delegation
  - Circuit breaker + retry queue
- Phase 2: Advanced features
  - Claim status lifecycle (active/superseded/archived/retracted)
  - Subagent scoped graphs
  - Trust tiers (system > tool_output > user_statement > speculation)
- Phase 3: Production readiness
  - Contradiction detection stub
  - Observability & metrics
  - Plugin versioning