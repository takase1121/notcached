import { NotcachedItems } from './NotcachedItem'
import { RETURN_TYPE } from '../Constants'

/**
 * An interface that a memcached client should implement.
 */
export interface MemcachedClient {
    buffer(): this;
    string(): this;
    returnType(type: RETURN_TYPE): this;
    set(key: string, value: Buffer|string, expireTime: number|Date, flags: number): Promise<void>;
    add(key: string, value: Buffer|string, expireTime: number|Date, flags: number): Promise<void>;
    replace(key: string, value: Buffer|string, expireTime: number|Date, flags: number): Promise<void>;
    cas(key: string, value: Buffer|string, cas: string, expireTime: number|Date, flags: number): Promise<void>;
    append(key: string, value: Buffer|string): Promise<void>;
    prepend(key: string, value: Buffer|string): Promise<void>;
    get(...keys: string[]): Promise<NotcachedItems>;
    gets(...keys: string[]): Promise<NotcachedItems>;
    delete(key: string): Promise<void>;
    incr(key: string, value: number): Promise<number>;
    decr(key: string, value: number): Promise<number>;
    touch(key: string, expireTime: number|Date): Promise<void>;
    gat(expireTime: number|Date, ...keys:string[]): Promise<NotcachedItems>;
    gats(expireTime: number|Date, ...keys: string[]): Promise<NotcachedItems>;
    flushAll(delay: number): Promise<void>;
    end(flush?: boolean): Promise<void>;
}
