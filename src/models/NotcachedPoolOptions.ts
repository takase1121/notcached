/**
 * Pool options. Copied and modified from
 * https://github.com/Vincit/tarn.js/blob/b577cfc3b1e2f193c5a6a18645f5ac97dcc75600/src/Pool.ts#L7
 */
export interface NotcachedPoolOptions {
    min: number;
    max: number;
    acquireTimeoutMillis?: number;
    createTimeoutMillis?: number;
    destroyTimeoutMillis?: number;
    idleTimeoutMillis?: number;
    createRetryIntervalMillis?: number;
    reapIntervalMillis?: number;
    propagateCreateError?: boolean;
}
