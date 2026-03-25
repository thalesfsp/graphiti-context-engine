// Track active subagent scopes
const activeScopes = new Map();
export const DEFAULT_GROUPS = ['helix', 'ringboost', 'system', 'personal'];
export function createSubagentScope(parentSessionId, subagentId) {
    const scope = {
        parentSessionId,
        subagentId,
        groupId: `${parentSessionId}:${subagentId}`,
        startedAt: new Date().toISOString(),
        status: 'active',
    };
    activeScopes.set(subagentId, scope);
    return scope;
}
export function getSubagentScope(subagentId) {
    return activeScopes.get(subagentId);
}
export function getGroupIdForSession(sessionId, subagentId) {
    // If explicit subagentId provided, use it
    if (subagentId) {
        const scope = activeScopes.get(subagentId);
        if (scope)
            return scope.groupId;
        return `${sessionId}:${subagentId}`;
    }
    // Auto-detect subagent from sessionId pattern: "...:subagent:UUID"
    if (isSubagentSession(sessionId)) {
        const parts = sessionId.split(':subagent:');
        if (parts.length === 2) {
            const parentPart = parts[0]; // e.g., "agent:main" or "agent:worker-grok"
            const subagentUuid = parts[1]; // The UUID
            if (!subagentUuid?.trim()) {
                return 'default';
            }
            // Check if we have an active scope for this subagent
            const scope = activeScopes.get(subagentUuid);
            if (scope)
                return scope.groupId;
            // Fallback: construct isolated groupId from session pattern
            return `${parentPart}:${subagentUuid}`;
        }
    }
    // Main agent: use first meaningful part
    const parts = sessionId.split(':');
    // For "agent:main" -> "main", for "discord:123" -> "discord"
    return parts[1] || parts[0] || 'default';
}
export function getGroupIdsForSession(sessionId, subagentId) {
    // For subagents, we only want their isolated graph
    if (subagentId || isSubagentSession(sessionId)) {
        return [getGroupIdForSession(sessionId, subagentId)];
    }
    const groupId = getGroupIdForSession(sessionId);
    if (DEFAULT_GROUPS.includes(groupId)) {
        return [groupId];
    }
    return DEFAULT_GROUPS;
}
export async function completeSubagentScope(subagentId, summary) {
    const scope = activeScopes.get(subagentId);
    if (!scope)
        return null;
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
export function isSubagentSession(sessionId) {
    return sessionId.includes(':subagent:');
}
//# sourceMappingURL=subagent-scope.js.map