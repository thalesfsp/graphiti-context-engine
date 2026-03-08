const startTime = Date.now();
const MAX_LATENCY_SAMPLES = 100;
const metrics = {
    claims_ingested: 0,
    claims_extracted: 0,
    searches_executed: 0,
    search_latency_ms: [],
    circuit_breaker_opens: 0,
    retry_queue_depth: 0,
    errors: 0,
    uptime_ms: 0,
};
export function recordIngest(count = 1) {
    metrics.claims_ingested += count;
}
export function recordExtraction(count = 1) {
    metrics.claims_extracted += count;
}
export function recordSearch(latencyMs) {
    metrics.searches_executed++;
    metrics.search_latency_ms.push(latencyMs);
    if (metrics.search_latency_ms.length > MAX_LATENCY_SAMPLES) {
        metrics.search_latency_ms.shift();
    }
}
export function recordCircuitBreakerOpen() {
    metrics.circuit_breaker_opens++;
}
export function recordError(error) {
    metrics.errors++;
    metrics.last_error = error;
}
export function setRetryQueueDepth(depth) {
    metrics.retry_queue_depth = depth;
}
export function getMetrics() {
    return {
        ...metrics,
        uptime_ms: Date.now() - startTime,
    };
}
export function getSearchLatencyPercentiles() {
    const sorted = [...metrics.search_latency_ms].sort((a, b) => a - b);
    const len = sorted.length;
    if (len === 0)
        return { p50: 0, p95: 0, p99: 0 };
    return {
        p50: sorted[Math.floor(len * 0.5)] || 0,
        p95: sorted[Math.floor(len * 0.95)] || 0,
        p99: sorted[Math.floor(len * 0.99)] || 0,
    };
}
export function resetMetrics() {
    metrics.claims_ingested = 0;
    metrics.claims_extracted = 0;
    metrics.searches_executed = 0;
    metrics.search_latency_ms = [];
    metrics.circuit_breaker_opens = 0;
    metrics.retry_queue_depth = 0;
    metrics.errors = 0;
    metrics.last_error = undefined;
}
//# sourceMappingURL=metrics.js.map