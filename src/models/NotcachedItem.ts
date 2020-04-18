export interface NotcachedItem {
    flags: number;
    data: Buffer|string;
    cas?: string;
}