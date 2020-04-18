interface DebugCallback {
    (...str: string[]): void;
}

export interface NotcachedOptions {
    debug?: boolean | DebugCallback;
    retries?: number;
    retryTime?: number;
    connectionTimeout?: number;
    timeout?: number;
    tcp?: object;
    legacyFlags?: boolean;
};
