/**
 * A memcached item, returned by retrieval commands
 */
export interface NotcachedItem {
    /** Flags */
    flags: number;
    /** Data */
    data: Buffer|string;
    /** CAS ID */
    cas?: string;
}

/**
 * This represents items that are fetched via retrieval commands
 */
export interface NotcachedItems {
    [key: string]: NotcachedItem;
}
