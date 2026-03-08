/**
 * OpenClaw Context Engine Plugin — Graphiti Knowledge Graph
 * 
 * Persistent memory via Graphiti knowledge graph (Neo4j backend).
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// Import from compiled output
const { GraphitiContextEngine } = require("./dist/engine.js");

export default function register(api: OpenClawPluginApi) {
  api.registerContextEngine("graphiti-context-engine", () => {
    const engine = new GraphitiContextEngine();
    
    return {
      info: engine.info,
      
      async ingest(ctx: any) {
        return engine.ingest(ctx);
      },
      
      async afterTurn(ctx: any) {
        return engine.afterTurn(ctx);
      },
      
      async assemble(ctx: any) {
        return engine.assemble(ctx);
      },
      
      async compact(ctx: any) {
        return engine.compact(ctx);
      },
      
      // Expose stats for observability
      async getStats() {
        return engine.getStats();
      },
    };
  });
  
  console.log("[graphiti-context-engine] v1.0.0 registered with full engine");
}
