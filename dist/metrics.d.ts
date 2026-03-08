export interface EngineMetrics {
    claims_ingested: number;
    claims_extracted: number;
    searches_executed: number;
    search_latency_ms: number[];
    circuit_breaker_opens: number;
    retry_queue_depth: number;
    errors: number;
    last_error?: string;
    uptime_ms: number;
}
export declare function recordIngest(count?: number): void;
export declare function recordExtraction(count?: number): void;
export declare function recordSearch(latencyMs: number): void;
export declare function recordCircuitBreakerOpen(): void;
export declare function recordError(error: string): void;
export declare function setRetryQueueDepth(depth: number): void;
export declare function getMetrics(): EngineMetrics;
export declare function getSearchLatencyPercentiles(): {
    p50: number;
    p95: number;
    p99: number;
};
export declare function resetMetrics(): void;
//# sourceMappingURL=metrics.d.ts.map