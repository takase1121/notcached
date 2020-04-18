import { NotcachedItem } from './NotcachedItem' // eslint-disable-line no-unused-vars
import { NotcachedItems } from './NotcachedItems' // eslint-disable-line no-unused-vars

/**
 * A request in queue
 */
export interface NotcachedQueueItem {
    /**
     * Resolve function created by `Promise` constructor
     */
    resolve: any;
    /**
     * Reject function created by `Promise` constructor
     */
    reject: any;
    /**
     * Command name. Eg: get, gets, gat
     */
    commandName: string;
    /**
     * The command itself that includes args
     */
    command: string;
    /**
     * Optional payload block to send to server
     */
    data?: Buffer;
    /**
     * For retrieval commands, this will be created to store the data from the server
     */
    replyItems?: NotcachedItems;
}
