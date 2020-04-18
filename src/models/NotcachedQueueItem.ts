import { NotcachedItem } from './NotcachedItem' // eslint-disable-line no-unused-vars

export interface NotcachedQueueItem {
    resolve: any;
    reject: any;
    commandName: string;
    command: string;
    data?: Buffer;
    replyItems?: { [key: string]: NotcachedItem };
}
