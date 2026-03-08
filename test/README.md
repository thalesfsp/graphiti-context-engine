# Graphiti Context Engine Tests

## Run Tests

```bash
npm test          # Unit + integration tests (vitest)
npm run build     # TypeScript compile check
```

## Test Coverage

| File | Tests | Covers |
|------|-------|--------|
| queue.test.ts | 3 | Enqueue, dedupe (sessionId+messageId), drain/clear |
| engine.test.ts | 7 | Init, ingest speed, assemble fallback, compact delegation, afterTurn drain, ownsCompaction=false |
| integration.test.ts | 4 | Full pipeline (ingest→afterTurn→assemble), compact, graceful degradation, heartbeat skip |
| extractor.test.ts | 1 | Stub extraction returns empty claims |
| context-builder.test.ts | 7 | Query extraction, context building, token estimation |
| circuit-breaker.test.ts | 4 | Threshold open, fallback, reset timeout, healthy state |

## Known Limitations

- **LLM extraction stubbed**: `extractClaims()` returns empty array; real LLM integration needs OpenClaw plugin API
- **Graphiti operations mocked**: Integration tests don't require running Graphiti server
- **No e2e coverage**: Real Graphiti server tests need `localhost:8721` running
