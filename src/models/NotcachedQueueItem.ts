import { NotcachedItem } from "./NotcachedItem";

export interface NotcachedQueueItem {
    resolve: any;
    reject: any;
    commandName: string;
    command: string;
    data?: Buffer;
    replyItems?: { [key: string]: NotcachedItem };
}