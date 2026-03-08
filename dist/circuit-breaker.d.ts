export declare class CircuitBreaker {
    private state;
    call<T>(fn: () => Promise<T>, fallback: T): Promise<{
        result: T;
        succeeded: boolean;
    }>;
    isHealthy(): boolean;
}
export declare const graphitiCircuit: CircuitBreaker;
//# sourceMappingURL=circuit-breaker.d.ts.map