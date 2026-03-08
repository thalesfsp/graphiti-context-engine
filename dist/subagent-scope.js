// Track active subagent scopes
const activeScopes = new Map();
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
    if (subagentId) {
        const scope = activeScopes.get(subagentId);
        if (scope)
            return scope.groupId;
        const parts = sessionId.split(':');
        return `${parts[2] || 'default'}:${subagentId}`;
    }
    // Use session-based grouping for main agent (match current engine logic)
    const parts = sessionId.split(':');
    return parts[2] || 'default';
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