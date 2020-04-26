import { PoolOptions } from 'tarn/lib/Pool'
import { Pool } from 'tarn'
import merge from 'deepmerge'

import { Notcached } from './Notcached'
import { MemcachedClient } from './models/MemcachedClient'
import { NotcachedOptions } from './models/NotcachedOptions'
import { NotcachedPoolOptions } from './models/NotcachedPoolOptions'
import { mergeDefaultOptions } from './models/NotcachedDefaultOptions'
import { NotcachedItems } from './models/NotcachedItem'
import { RETURN_TYPE } from './Constants'
import { is } from './Util'

/**
 *
 * @param location Location of the memcached server, eg: `127.0.0.1:11211`
 * @param poolOptions Pool options. This is the same with `tarn.js` options without `create`, `destroy` and `validate`
 * @param clientOptions Client options
 */
export function createPool (location: string, poolOptions: NotcachedPoolOptions, clientOptions?: NotcachedOptions) {
  return new NotcachedPool(location, poolOptions, clientOptions)
}

/**
 * A pool of Notcached clients. This uses tarn.js pool.
 * This pool implements `MemcachedClient`, so it has similiar usage as `Notcached`.
 */
export class NotcachedPool implements MemcachedClient {
  /** Connection string */
    public readonly location: string;
    /** Pool options */
    public readonly poolOptions: PoolOptions<Notcached>;
    /** Client options */
    public readonly clientOptions: NotcachedOptions;
    /** The pool */
    public pool: Pool<Notcached>;

    /** Return type */
    protected returnedData: RETURN_TYPE;
    /** Determines if queue should be flushed upon destruction */
    protected shouldFlush: boolean;

    constructor (location: string, poolOptions: NotcachedPoolOptions, clientOptions?: NotcachedOptions) {
      is.locationString(location)

      this.location = location
      this.clientOptions = mergeDefaultOptions(clientOptions)
      this.poolOptions = merge(poolOptions, {
        create: this.createClient.bind(this),
        destroy: this.destroyClient.bind(this),
        validate: this.validateClient.bind(this)
      })
      this.pool = new Pool<Notcached>(this.poolOptions)
      this.returnedData = RETURN_TYPE.BUFFER
      this.shouldFlush = false
    }

    returnType (type: RETURN_TYPE): this {
      this.returnedData = type
      return this
    }

    buffer (): this {
      this.returnedData = RETURN_TYPE.BUFFER
      return this
    }

    string (): this {
      this.returnedData = RETURN_TYPE.STRING
      return this
    }

    async set (key: string, value: string | Buffer, expireTime: number | Date, flags: number): Promise<void> {
      const client = await this.pool.acquire().promise
      return await this.executeCommand(client, client.set, key, value, expireTime, flags)
    }

    async add (key: string, value: string | Buffer, expireTime: number | Date, flags: number): Promise<void> {
      const client = await this.pool.acquire().promise
      return await this.executeCommand(client, client.add, key, value, expireTime, flags)
    }

    async replace (key: string, value: string | Buffer, expireTime: number | Date, flags: number): Promise<void> {
      const client = await this.pool.acquire().promise
      return await this.executeCommand(client, client.replace, key, value, expireTime, flags)
    }

    async cas (key: string, value: string | Buffer, cas: string, expireTime: number | Date, flags: number): Promise<void> {
      const client = await this.pool.acquire().promise
      return await this.executeCommand(client, client.cas, key, value, cas, expireTime, flags)
    }

    async append (key: string, value: string | Buffer): Promise<void> {
      const client = await this.pool.acquire().promise
      return await this.executeCommand(client, client.append, key, value)
    }

    async prepend (key: string, value: string | Buffer): Promise<void> {
      const client = await this.pool.acquire().promise
      return await this.executeCommand(client, client.prepend, key, value)
    }

    async get (...keys: string[]): Promise<NotcachedItems> {
      const client = await this.pool.acquire().promise
      return await this.executeCommand(client, client.get, ...keys)
    }

    async gets (...keys: string[]): Promise<NotcachedItems> {
      const client = await this.pool.acquire().promise
      return await this.executeCommand(client, client.get, ...keys)
    }

    async delete (key: string): Promise<void> {
      const client = await this.pool.acquire().promise
      return await this.executeCommand(client, client.delete, key)
    }

    async incr (key: string, value: number): Promise<number> {
      const client = await this.pool.acquire().promise
      return await this.executeCommand(client, client.incr, key, value)
    }

    async decr (key: string, value: number): Promise<number> {
      const client = await this.pool.acquire().promise
      return await this.executeCommand(client, client.decr, key, value)
    }

    async touch (key: string, expireTime: number | Date): Promise<void> {
      const client = await this.pool.acquire().promise
      return await this.executeCommand(client, client.touch, key, expireTime)
    }

    async gat (expireTime: number | Date, ...keys: string[]): Promise<NotcachedItems> {
      const client = await this.pool.acquire().promise
      return await this.executeCommand(client, client.gat, expireTime, ...keys)
    }

    async gats (expireTime: number | Date, ...keys: string[]): Promise<NotcachedItems> {
      const client = await this.pool.acquire().promise
      return await this.executeCommand(client, client.gats, expireTime, ...keys)
    }

    async flushAll (delay: number): Promise<void> {
      const client = await this.pool.acquire().promise
      return await this.executeCommand(client, client.flushAll, delay)
    }

    async end (flush: boolean = false) {
      this.shouldFlush = flush
      this.pool.destroy()
    }

    protected async executeCommand (client: Notcached, command: (...args: any[]) => any, ...args: any) {
      try {
        client.returnType(this.returnedData)
        return await command(...args)
      } finally {
        this.pool.release(client)
      }
    }

    protected createClient (): Notcached {
      return new Notcached(this.location, this.clientOptions)
    }

    protected destroyClient (client: Notcached): Promise<void> {
      return client.removeAllListeners().end(this.shouldFlush)
    }

    protected validateClient (client: Notcached): boolean {
      return !client.destroyed
    }
}
