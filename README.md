# @thalesfsp/graphiti-context-engine

OpenClaw Context Engine plugin integrating Graphiti Knowledge Graph for persistent, claim-centric memory.

## Architecture Overview

- **Claim-Centric**: Extracts atomic claims from agent messages and stores them as graph nodes/relations.
- **Async Ingestion**: Background processing of message batches into the graph.
- **Vector Retrieval**: RAG-style query for relevant claims during `assemble()`.
- **Compaction**: Summarizes conversation turns into higher-level claims.

## Installation

```bash
npm install @thalesfsp/graphiti-context-engine
# Copy openclaw.plugin.json to your OpenClaw plugins dir
```

## Development

```bash
npm install
npm run build
npm test
```

## Usage

Registers automatically via `openclaw.plugin.json`.

## Claim Schema

```typescript
interface Claim {
  claim_id: string;           // UUID
  subject: string;            // Entity name (e.g., "Greice")
  predicate: string;          // Relationship (e.g., "birthday", "is_wife_of")
  object: string;             // Value (e.g., "March 15", "T")
  qualifiers?: Record<string, string>;  // Optional metadata (e.g., {"also_known_as": "Grace"})
  confidence: number;         // 0.0-1.0
  status: "active" | "superseded" | "disputed";
  source_message_id: string;  // OpenClaw message ID
  source_session_id: string;  // OpenClaw session ID
  extractor_version: string;  // e.g., "v1.0"
  created_at: string;         // ISO timestamp
  updated_at: string;         // ISO timestamp
}
```

## Graphiti Server Endpoints (port 8721)

### POST /claims/ingest
Input: `{ claims: Claim[], group_id: string }`
- Dedupes by `source_session_id + source_message_id + subject + predicate + object`
- Stores `:Claim` nodes, links to `:Entity` subjects/objects
- Returns: `{ ingested: number, duplicates: number }`

### POST /claims/search
Input: `{ query: string, group_id?: string, status?: string[], limit?: number }`
- Vector similarity search on `subject predicate object`
- Returns: `{ claims: Claim[], total: number }`

### GET /claims/{claim_id}
Returns full claim details

### PATCH /claims/{claim_id}/status
Input: `{ status: "active" | "superseded" | "disputed" }`
Updates and returns claim
