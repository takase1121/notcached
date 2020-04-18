/**
 * A callback used to log any debug events
 */
interface DebugCallback {
    (...str: string[]): void;
}

/**
 * Notcached options
 */
export interface NotcachedOptions {
    /**
     * If true, write and read operations will be logged via `console.log`. If it is a callback,
     * then the callback will be called with the message
     */
    debug: boolean | DebugCallback;
    /**
     * Number of retries before giving up
     */
    retries: number;
    /**
     * Time to wait before retrying
     */
    retryTime: number;
    /**
     * The time to wait for a connection before it is considered timed out
     * and proceed to reconnect
     */
    connectionTimeout: number;
    /**
     * Socket timeout. It is recommended to set this to `Infinity`.
     */
    timeout: number;
    /**
     * TCP options. Usually you don't need this
     */
    tcp: object;
    /**
     * Determine whether legacy flags to be enabled.
     * Legacy flags are 16-bit unsigned integers while non-legacy flags goes
     * up to 32-bit. See FAQ
     */
    legacyFlags: boolean;
};
