import { SubagentScope, SubagentSummary } from './types.js';
export declare const DEFAULT_GROUPS: readonly ["helix", "ringboost", "system", "personal"];
export declare function createSubagentScope(parentSessionId: string, subagentId: string): SubagentScope;
export declare function getSubagentScope(subagentId: string): SubagentScope | undefined;
/**
 * Returns array of group IDs to search for this session.
 * Main sessions search ALL default groups.
 * Subagent sessions are scoped to their project group + personal + system.
 */
export declare function getGroupIdsForSession(sessionId: string, subagentId?: string): string[];
/**
 * @deprecated Use getGroupIdsForSession instead (returns array)
 * Kept for backward compatibility - returns first group
 */
export declare function getGroupIdForSession(sessionId: string, subagentId?: string): string;
export declare function completeSubagentScope(subagentId: string, summary: string): Promise<SubagentSummary | null>;
export declare function isSubagentSession(sessionId: string): boolean;
/**
 * Detect project groups mentioned in the query text.
 * Returns matching groups + always includes 'personal' and 'system'.
 * Returns null if no project keywords found (caller should use default groups).
 */
export declare function detectGroupsFromQuery(query: string): string[] | null;
export interface ChannelMetadata {
    channelName?: string;
    channelId?: string;
    guildId?: string;
    isDM?: boolean;
    source?: string;
}
/**
 * Detect groups from channel metadata (primary signal).
 * DMs → personal + system only.
 * Named channels → match against project patterns.
 * Returns null if no metadata or no matches (caller falls through to query-based).
 */
export declare function detectGroupsFromChannel(meta: ChannelMetadata | undefined): string[] | null;
/**
 * Combined group resolution: channel metadata (primary) → query keywords (secondary) → defaults.
 * This is the main entry point for group filtering in assemble().
 */
export declare function resolveGroupIds(sessionId: string, options?: {
    subagentId?: string;
    query?: string;
    channelMeta?: ChannelMetadata;
}): string[];
//# sourceMappingURL=subagent-scope.d.ts.map