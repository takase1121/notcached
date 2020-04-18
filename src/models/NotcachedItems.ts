import { NotcachedItem } from './NotcachedItem' // eslint-disable-line no-unused-vars

/**
 * This represents items that are fetched via retrieval commands
 */
export interface NotcachedItems {
    [key: string]: NotcachedItem;
}
