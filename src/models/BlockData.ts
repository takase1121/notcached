/**
 * Represents a block of data, usually sent by server with the "VALUE" header.
 * This represents a memcached entry
 */
export interface BlockData {
    /**
     * Size of block
     */
    size: number | null;
    /**
     * Key for the block
     */
    key: string | null;
    /**
     * CAS ID
     */
    cas?: string;
    /**
     * Flags
     */
    flags: number | null;
    /**
     * Data
     */
    data: Buffer | null;
}
