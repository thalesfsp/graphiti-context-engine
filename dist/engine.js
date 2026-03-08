export class GraphitiContextEngine {
    info = {
        id: "graphiti-context-engine",
        name: "Graphiti Context Engine",
        version: "0.1.0",
    };
    async bootstrap(params) {
        return { bootstrapped: false };
    }
    async ingest(params) {
        // Stub: always ingest
        return { ingested: true };
    }
    async afterTurn(params) {
        // No-op stub
    }
    async assemble(params) {
        // Stub: return empty context
        return {
            messages: [],
            estimatedTokens: 0,
        };
    }
    async compact(params) {
        // Stub: no compaction
        return { ok: true, compacted: false };
    }
}
//# sourceMappingURL=engine.js.map