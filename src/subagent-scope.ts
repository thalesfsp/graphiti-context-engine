import { SubagentScope, SubagentSummary } from './types.js';

// Named groups in Graphiti (must match actual group names)
export const DEFAULT_GROUPS = ['helix', 'ringboost', 'system', 'personal'] as const;

// Track active subagent scopes
const activeScopes = new Map<string, SubagentScope>();

export function createSubagentScope(
  parentSessionId: string,
  subagentId: string
): SubagentScope {
  // Detect project from subagentId (e.g., "helix-api-agent" -> "helix")
  const groupId = detectGroupFromAgentId(subagentId) || 'personal';
  
  const scope: SubagentScope = {
    parentSessionId,
    subagentId,
    groupId,
    startedAt: new Date().toISOString(),
    status: 'active',
  };
  activeScopes.set(subagentId, scope);
  return scope;
}

export function getSubagentScope(subagentId: string): SubagentScope | undefined {
  return activeScopes.get(subagentId);
}

/**
 * Returns array of group IDs to search for this session.
 * Main sessions search ALL default groups.
 * Subagent sessions are scoped to their project group + personal + system.
 */
export function getGroupIdsForSession(sessionId: string, subagentId?: string): string[] {
  // If explicit subagentId provided, check for active scope
  if (subagentId) {
    const scope = activeScopes.get(subagentId);
    if (scope) {
      // Subagent gets its project group + personal + system
      return [scope.groupId, 'personal', 'system'].filter((v, i, a) => a.indexOf(v) === i);
    }
    
    // Detect from agentId pattern
    const detected = detectGroupFromAgentId(subagentId);
    if (detected) {
      return [detected, 'personal', 'system'];
    }
  }
  
  // Auto-detect subagent from sessionId pattern: "...:subagent:UUID"
  if (isSubagentSession(sessionId)) {
    const parts = sessionId.split(':');
    // Try to detect project from agent name in session (e.g., "agent:helix-api-agent:subagent:...")
    const agentPart = parts[1];
    if (agentPart) {
      const detected = detectGroupFromAgentId(agentPart);
      if (detected) {
        return [detected, 'personal', 'system'];
      }
    }
    // Unknown subagent - give it personal + system
    return ['personal', 'system'];
  }
  
  // Main agent sessions: search ALL default groups
  return [...DEFAULT_GROUPS];
}

/**
 * @deprecated Use getGroupIdsForSession instead (returns array)
 * Kept for backward compatibility - returns first group
 */
export function getGroupIdForSession(sessionId: string, subagentId?: string): string {
  const groups = getGroupIdsForSession(sessionId, subagentId);
  return groups[0] || 'personal';
}

/**
 * Detect project group from agent ID pattern
 */
function detectGroupFromAgentId(agentId: string): string | null {
  const lower = agentId.toLowerCase();
  
  if (lower.includes('helix')) return 'helix';
  if (lower.includes('ringboost')) return 'ringboost';
  if (lower.includes('system') || lower.includes('validator')) return 'system';
  if (lower.includes('personal') || lower.includes('nova')) return 'personal';
  
  // Check for project prefixes
  for (const group of DEFAULT_GROUPS) {
    if (lower.startsWith(group + '-') || lower.startsWith(group + '_')) {
      return group;
    }
  }
  
  return null;
}

export async function completeSubagentScope(
  subagentId: string,
  summary: string
): Promise<SubagentSummary | null> {
  const scope = activeScopes.get(subagentId);
  if (!scope) return null;
  
  scope.status = 'completed';
  activeScopes.delete(subagentId);
  
  return {
    subagentId,
    parentSessionId: scope.parentSessionId,
    summary,
    claimCount: 0, // Would query actual count
    startedAt: scope.startedAt,
    completedAt: new Date().toISOString(),
  };
}

export function isSubagentSession(sessionId: string): boolean {
  return sessionId.includes(':subagent:');
}

// ─── Query-based group detection ────────────────────────────────────────────
// Extracts project hints from the query text itself to narrow search groups.
// Used as secondary signal (after channel metadata) for main sessions.

/** Map of keyword patterns → group names for query-based detection. */
const GROUP_KEYWORD_PATTERNS: Array<{ pattern: RegExp; group: string }> = [
  { pattern: /\bhelix\b/i, group: 'helix' },
  { pattern: /\bringboost\b/i, group: 'ringboost' },
];

/**
 * Detect project groups mentioned in the query text.
 * Returns matching groups + always includes 'personal' and 'system'.
 * Returns null if no project keywords found (caller should use default groups).
 */
export function detectGroupsFromQuery(query: string): string[] | null {
  const detected = new Set<string>();

  for (const { pattern, group } of GROUP_KEYWORD_PATTERNS) {
    if (pattern.test(query)) {
      detected.add(group);
    }
  }

  if (detected.size === 0) return null; // No hints — use defaults

  // Always include personal + system alongside detected project groups
  detected.add('personal');
  detected.add('system');
  return [...detected];
}

// ─── Channel metadata-based group detection ─────────────────────────────────
// When the gateway passes channel metadata (Discord channel name, DM, etc.),
// use it as primary signal to narrow groups.

/** Map of channel name patterns → group names. */
const CHANNEL_GROUP_PATTERNS: Array<{ pattern: RegExp; group: string }> = [
  { pattern: /\bhelix\b/i, group: 'helix' },
  { pattern: /\bringboost\b/i, group: 'ringboost' },
  { pattern: /\bproj-helix\b/i, group: 'helix' },
  { pattern: /\bproj-ringboost\b/i, group: 'ringboost' },
];

export interface ChannelMetadata {
  channelName?: string;
  channelId?: string;
  guildId?: string;
  isDM?: boolean;
  source?: string; // 'discord', 'whatsapp', 'cli', etc.
}

/**
 * Detect groups from channel metadata (primary signal).
 * DMs → personal + system only.
 * Named channels → match against project patterns.
 * Returns null if no metadata or no matches (caller falls through to query-based).
 */
export function detectGroupsFromChannel(meta: ChannelMetadata | undefined): string[] | null {
  if (!meta) return null;

  // DMs with no channel name → personal + system only
  if (meta.isDM) {
    return ['personal', 'system'];
  }

  // Try to match channel name to project group
  if (meta.channelName) {
    const detected = new Set<string>();
    for (const { pattern, group } of CHANNEL_GROUP_PATTERNS) {
      if (pattern.test(meta.channelName)) {
        detected.add(group);
      }
    }
    if (detected.size > 0) {
      detected.add('personal');
      detected.add('system');
      return [...detected];
    }
  }

  return null; // No match — fall through to query-based detection
}

/**
 * Combined group resolution: channel metadata (primary) → query keywords (secondary) → defaults.
 * This is the main entry point for group filtering in assemble().
 */
export function resolveGroupIds(
  sessionId: string,
  options?: {
    subagentId?: string;
    query?: string;
    channelMeta?: ChannelMetadata;
  },
): string[] {
  // 1. Subagent scoping takes priority (unchanged behavior)
  if (options?.subagentId) {
    return getGroupIdsForSession(sessionId, options.subagentId);
  }
  if (isSubagentSession(sessionId)) {
    return getGroupIdsForSession(sessionId);
  }

  // 2. Channel metadata (primary signal for main sessions)
  const fromChannel = detectGroupsFromChannel(options?.channelMeta);
  if (fromChannel) return fromChannel;

  // 3. Query keyword extraction (secondary signal)
  if (options?.query) {
    const fromQuery = detectGroupsFromQuery(options.query);
    if (fromQuery) return fromQuery;
  }

  // 4. Default: all groups
  return [...DEFAULT_GROUPS];
}
