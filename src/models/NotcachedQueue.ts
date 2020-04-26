import { NotcachedItems } from './NotcachedItem' // eslint-disable-line no-unused-vars
import { EventEmitter } from 'events'

/**
 * A request in queue
 */
export interface NotcachedQueueItem {
    /** Resolve function created by `Promise` constructor */
    resolve: any;
    /** Reject function created by `Promise` constructor */
    reject: any;
    /** Command name. Eg: get, gets, gat */
    commandName: string;
    /** The command itself that includes args */
    command: string;
    /** Optional payload block to send to server */
    data?: Buffer;
    /** For retrieval commands, this will be created to store the data from the server */
    replyItems?: NotcachedItems;
}

/**
 * A queue that stores NotcachedQueueItems and emits events
 */
export class NotcachedQueue extends EventEmitter {
    /**
     * The internal queue
     */
    protected queue: NotcachedQueueItem[] = [];
    /**
     * Queue size
     */
    public get size () {
      return this.queue.length
    }

    /**
     * A shorthand that behaves like `array.prototype.length`. Can be used to change queue size
     */
    public set size (value: number) {
      this.queue.length = value
    }

    /**
     * Add something to queue
     * @param value
     */
    public push (value: NotcachedQueueItem) {
      /** @event add When something is added */
      this.emit('add')
      return this.queue.push(value)
    }

    /**
     * Get something from the top of the queue
     */
    public shift () {
      /** @event remove When an item is removed from the queue */
      this.emit('remove')
      /** @event empty When the queue is empty */
      if (this.queue.length === 0) this.emit('empty')
      return this.queue.shift()
    }

    /**
     * Destroys the queue
     * @param fn Function to execute before destruction. Check `array.prototype.forEach`
     */
    public destroy (fn?: (item: NotcachedQueueItem, index: number, queue: NotcachedQueueItem[]) => void) {
      if (fn && typeof fn === 'function') {
        this.queue.forEach(fn)
      }
      this.queue.length = 0
    }

    public on(event: 'add', listener: () => void): this;
    public on(event: 'remove', listener: () => void): this;
    public on(event: 'empty', listener: () => void): this;
    public on (event: any, listener: (...args: any[]) => void): this {
      return super.on(event, listener)
    }

    public once(event: 'add', listener: () => void): this;
    public once(event: 'remove', listener: () => void): this;
    public once(event: 'empty', listener: () => void): this;
    public once (event: any, listener: (...args: any[]) => void): this {
      return super.on(event, listener)
    }
}
