/**
 * OpenClaw Context Engine Plugin — Graphiti Knowledge Graph
 * 
 * Forwards ALL engine methods including optional ones:
 * - info, ingest, afterTurn, assemble, compact, getStats (required)
 * - bootstrap, onSubagentComplete, getVersion, dispose (optional)
 * 
 * Also registers first-class tools:
 * - graphiti_search: Search the knowledge graph
 * - graphiti_store: Store a fact directly
 * - graphiti_get: Retrieve an entity or episode by ID
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const { GraphitiContextEngine } = require("./dist/engine.js");

const GRAPHITI_URL = process.env.GRAPHITI_URL || "http://localhost:8721";
const TOOL_TIMEOUT_MS = 8000;

const debug = !!process.env.GRAPHITI_DEBUG;

// ============================================================================
// Helpers
// ============================================================================

async function graphitiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
  try {
    return await fetch(`${GRAPHITI_URL}${path}`, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// Plugin Registration
// ============================================================================

const graphitiPlugin = {
  id: "graphiti-context-engine",
  name: "Graphiti Context Engine",
  description: "Persistent knowledge graph memory using Graphiti + Neo4j",
  
  register(api: OpenClawPluginApi) {
  try {
    // ── Context Engine ──────────────────────────────────────────────────────
    api.registerContextEngine("graphiti-context-engine", () => {
      const engine = new GraphitiContextEngine();

      if (debug) {
        console.log("[graphiti-context-engine] [DEBUG] Factory called, engine created");
        console.log("[graphiti-context-engine] [DEBUG] Engine methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(engine)));
      }

      return {
        info: engine.info,
        ingest: engine.ingest.bind(engine),
        afterTurn: engine.afterTurn.bind(engine),
        assemble: engine.assemble.bind(engine),
        compact: engine.compact.bind(engine),
        getStats: engine.getStats.bind(engine),
        bootstrap: engine.bootstrap.bind(engine),
        onSubagentComplete: engine.onSubagentComplete.bind(engine),
        getVersion: engine.getVersion.bind(engine),
        dispose: async () => {
          if (debug) console.log("[graphiti-context-engine] [DEBUG] dispose called");
          return { disposed: true };
        },
      };
    });

    if (debug) console.log("[graphiti-context-engine] [DEBUG] v1.0.0 context engine registration complete");

    // ── Tools ───────────────────────────────────────────────────────────────

    // Tool 1: graphiti_search
    api.registerTool(
      {
        name: "graphiti_search",
        label: "Graphiti Search",
        description:
          "Search the Graphiti knowledge graph for facts and relationships. Use when you need context from the knowledge graph about projects, decisions, or technical details.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          group: Type.Optional(
            Type.String({
              description:
                "Group to search (helix, ringboost, personal, system). Omit to search all.",
            }),
          ),
          limit: Type.Optional(
            Type.Number({ description: "Max results (default: 10)" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { query, group, limit = 10 } = params as {
            query: string;
            group?: string;
            limit?: number;
          };

          try {
            const body: Record<string, unknown> = {
              query,
              num_results: limit,
            };
            if (group) {
              body.group_ids = [group];
            }

            const res = await graphitiFetch("/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });

            if (!res.ok) {
              throw new Error(`Graphiti search error: ${res.status} ${res.statusText}`);
            }

            const data: any = await res.json();
            const results = data.results || data.edges || [];

            if (!results.length) {
              return {
                content: [{ type: "text", text: "No results found in Graphiti." }],
                details: { count: 0 },
              };
            }

            const text = results
              .map(
                (r: any, i: number) =>
                  `${i + 1}. ${r.fact || r.description || r.name || "(no description)"} (id: ${r.uuid || r.id || "?"})`,
              )
              .join("\n");

            const sanitized = results.map((r: any) => ({
              id: r.uuid || r.id,
              fact: r.fact || r.description || r.name,
              score: r.score,
              group_id: r.group_id,
              source: r.source_node_name,
              target: r.target_node_name,
            }));

            return {
              content: [
                {
                  type: "text",
                  text: `Found ${results.length} result(s):\n\n${text}`,
                },
              ],
              details: { count: results.length, results: sanitized },
            };
          } catch (err) {
            const msg = (err as Error).name === "AbortError"
              ? "Graphiti search timed out"
              : `Graphiti search failed: ${String(err)}`;
            return {
              content: [{ type: "text", text: msg }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "graphiti_search" },
    );

    // Tool 2: graphiti_store
    api.registerTool(
      {
        name: "graphiti_store",
        label: "Graphiti Store",
        description:
          "Store a fact directly in the Graphiti knowledge graph. Use for important decisions, facts, or project knowledge worth persisting long-term.",
        parameters: Type.Object({
          fact: Type.String({ description: "The fact to store" }),
          group_id: Type.String({
            description: "Group: helix, ringboost, personal, or system",
          }),
          source: Type.Optional(
            Type.String({ description: "Source attribution (default: nova)" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { fact, group_id, source = "nova" } = params as {
            fact: string;
            group_id: string;
            source?: string;
          };

          try {
            const res = await graphitiFetch("/store", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fact, group_id, source }),
            });

            if (!res.ok) {
              const errBody = await res.text().catch(() => "");
              throw new Error(`Graphiti store error: ${res.status} ${res.statusText}${errBody ? ` — ${errBody}` : ""}`);
            }

            const data: any = await res.json();

            return {
              content: [
                {
                  type: "text",
                  text: `Stored in Graphiti (group: ${group_id}). Episode ID: ${data.episode_id || "unknown"}`,
                },
              ],
              details: {
                action: "stored",
                episode_id: data.episode_id,
                group_id,
                source,
              },
            };
          } catch (err) {
            const msg = (err as Error).name === "AbortError"
              ? "Graphiti store timed out"
              : `Graphiti store failed: ${String(err)}`;
            return {
              content: [{ type: "text", text: msg }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "graphiti_store" },
    );

    // Tool 3: graphiti_get
    api.registerTool(
      {
        name: "graphiti_get",
        label: "Graphiti Get",
        description:
          "Retrieve a specific entity or episode by ID from the Graphiti knowledge graph.",
        parameters: Type.Object({
          id: Type.String({ description: "Entity or episode UUID" }),
        }),
        async execute(_toolCallId, params) {
          const { id } = params as { id: string };

          try {
            const res = await graphitiFetch(`/entity/${encodeURIComponent(id)}`);

            if (res.status === 404) {
              return {
                content: [{ type: "text", text: `Entity not found: ${id}` }],
                details: { found: false },
              };
            }

            if (!res.ok) {
              throw new Error(`Graphiti get error: ${res.status} ${res.statusText}`);
            }

            const data: any = await res.json();

            const lines: string[] = [
              `ID: ${data.uuid || id}`,
              `Name: ${data.name || "(none)"}`,
              `Summary: ${data.summary || "(none)"}`,
              `Group: ${data.group_id || "(none)"}`,
            ];

            return {
              content: [
                {
                  type: "text",
                  text: lines.join("\n"),
                },
              ],
              details: { found: true, entity: data },
            };
          } catch (err) {
            const msg = (err as Error).name === "AbortError"
              ? "Graphiti get timed out"
              : `Graphiti get failed: ${String(err)}`;
            return {
              content: [{ type: "text", text: msg }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "graphiti_get" },
    );

    if (debug) console.log("[graphiti-context-engine] [DEBUG] Tools registered: graphiti_search, graphiti_store, graphiti_get");
  } catch (e: any) {
    console.error("[graphiti-context-engine] Registration FAILED:", e.message);
    console.error("[graphiti-context-engine] Stack:", e.stack);
  }
  },
};

export default graphitiPlugin;
