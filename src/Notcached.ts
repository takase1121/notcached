import ow from 'ow';
import merge from 'deepmerge';
import { inspect } from 'util';
import { EventEmitter } from 'events';
import { connect, Socket, NetConnectOpts } from 'net';

import { is, memcachedDate } from './Util'

import { MAX_FLAG, MAX_LEGACY_FLAG, RETRIEVAL_COMMANDS, SEP } from './Constants';
import { NotcachedOptions, NotcachedItem, NotcachedItems, NotcachedQueueItem, SocketData } from './models'


export class Notcached extends EventEmitter {
    /**
     * @event error Emitted when socket errors. Comes with an Error object. The connection will close right after.
     */

    /**
     * @event closed Emitted when socket closes. Comes with an error object if it is a socket error.
     */

    /**
     * @event timeout Emitted when socket times out. Reconnection will follow soon after
     */

    /**
     * @event ready Emitted when socket is ready for data transfer
     */

    /**
     * @event reconnect Emitted when socket started reconnecting
     */

    /**
     * @event connect Emitted when socket started connecting
     */
    
    public destroyed: boolean;
    
    private location: { host: string, port: number };
    private options: NotcachedOptions;

    private MAX_FLAG_SIZE: number;
    private socketError?: Error;
    private socketData: SocketData;
    private retries: number;
    private queue: NotcachedQueueItem[];
    private currentItem?: NotcachedQueueItem;
    private socket?: Socket;
    private returnBuffer: boolean;
    private connectionTimeout: any;

    /**
     * Make a single connection to a server
     * @param connectionString Location of the memcached server, eg: `127.0.0.1:11211`
     * @param options Options
     */
    constructor(connectionString: string, options?: Partial<NotcachedOptions>) {
        super();
        if (!connectionString.match(/(.+):(\d+)$/)) {
            throw new Error('Server path must be "ip:port"');
        }

        const defaultOptions = {
            debug: false,
            retries: 3,
            retryTime: 3000,
            timeout: Infinity,
            connectionTimeout: 3000,
            tcp: {},
            legacyFlags: true
        } as NotcachedOptions;

        this.options = merge(defaultOptions, options || {});
        this.MAX_FLAG_SIZE = this.options.legacyFlags ? MAX_LEGACY_FLAG : MAX_FLAG;
        
        this.socketData = {
            buffer: Buffer.alloc(0),
            expectingBlock: false,
            block: {
                size: 0,
                flags: 0,
                key: null,
                data: null
            }
        };

        this.retries = 0;
        this.queue = [];
        this.destroyed = false;
        this.returnBuffer = true;
        this.connectionTimeout = null;
        
        const [host, port] = connectionString.split(':');
        this.location = { host, port: parseInt(port) };

        this.connect();
    }

    /**
     * If called, the proceeding requests will return Buffer instances
     */
    buffer() {
        this.returnBuffer = true;
        return this;
    }

    /**
     * If called, the proceeding requests will return strings
     */
    string() {
        this.returnBuffer = false;
        return this;
    }

    /**
     * Store something into the server
     * @param key Memcached key. See FAQ
     * @param value The data to store
     * @param expireTime Expiration date. Defaults to never (0) See FAQ
     * @param flags Flags to store the data with. See FAQ
     */
    set(key: string, value: Buffer|string, expireTime: number|Date = 0, flags: number = 0): Promise<void> {
        return this.execStorageCommand('set', key, flags, expireTime, value);
    }

    /**
     * Store something only if the server don't have it
     * @param key Memcached key. See FAQ
     * @param value The data to store
     * @param expireTime Expiration date. Defaults to never (0) See FAQ
     * @param flags Flags to store the data with. See FAQ
     */
    add(key: string, value: Buffer|string, expireTime: number|Date = 0, flags: number = 0): Promise<void> {
        return this.execStorageCommand('add', key, flags, expireTime, value);
    }

    /**
     * Store something only if the server have it
     * @param key Memcached key. See FAQ
     * @param value The data to store
     * @param expireTime Expiration date. Defaults to never (0) See FAQ
     * @param flags Flags to store the data with. See FAQ
     */
    replace(key: string, value: Buffer|string, expireTime: number|Date = 0, flags: number = 0): Promise<void> {
        return this.execStorageCommand('replace', key, flags, expireTime, value);
    }

    /**
     * A "check and set" operation.
     * "Store something only if someone else did not update it since last time I fetched it"
     * @param key Memcached key. See FAQ
     * @param value The data to store
     * @param cas CAS ID. Usually you get this ID via `gets`
     * @param expireTime Expiration date. Defaults to never (0) See FAQ
     * @param flags Flags to store the data with. See FAQ
     */
    cas(key: string, value: Buffer|string, cas: string, expireTime: number|Date = 0, flags: number = 0): Promise<void> {
        return this.execStorageCommand('cas', key, flags, expireTime, value, cas);
    }

    /**
     * Append onto existing data
     * @param key Memcached key. See FAQ
     * @param value The data to store
     */
    append(key: string, value: Buffer|string): Promise<void> {
        return this.execStorageCommand('append', key, 0, 0, value);
    }

    /**
     * Prepend onto existing data
     * @param key Memcached key. See FAQ
     * @param value 
     */
    prepend(key: string, value: Buffer|string): Promise<void> {
        return this.execStorageCommand('prepend', key, 0, 0, value);
    }

    /**
     * Get something / a lot of things
     * @param keys Memcached key. See FAQ
     */
    get(...keys: string[]): Promise<NotcachedItems> {
        return this.execRetrievalCommands('get', [...keys]);
    }

    /**
     * Get something / a lot of things with their CAS ID
     * @param keys Memcached key. See FAQ
     */
    gets(...keys: string[]): Promise<NotcachedItems> {
        return this.execRetrievalCommands('gets', [...keys]);
    }

    /**
     * Delete something
     * @param key Memcached key. See FAQ
     */
    delete(key: string): Promise<void> {
        is.memcachedKey(key);
        return this.command('delete', `delete ${key} \r\n`) as Promise<void>;
    }

    /**
     * Increment something
     * @param key Memcached key. See FAQ
     * @param value The value to increment
     */
    incr(key: string, value: number = 1): Promise<number> {
        is.memcachedKey(key);
        ow(value, ow.number.greaterThanOrEqual(1));
        return this.command('incr', `incr ${key} ${value} \r\n`) as Promise<number>;
    }

    /**
     * Decrement something
     * @param key Memcached key. See FAQ
     * @param value The value to decrement
     */
    decr(key: string, value: number = 1): Promise<number> {
        is.memcachedKey(key);
        ow(value, ow.number.greaterThanOrEqual(1));
        return this.command('decr', `decr ${key} ${value} \r\n`) as Promise<number>;
    }

    /**
     * Touch a key (Updating their expiration date)
     * @param key Memcached key. See FAQ
     * @param expireTime
     */
    touch(key: string, expireTime: number|Date = 0): Promise<void> {
        is.memcachedKey(key);
        is.numberOrDate(expireTime);
        return this.command('touch', `touch ${key} ${memcachedDate(expireTime)} \r\n`) as Promise<void>;
    }

    /**
     * Get and touch. Fetch items and update the expiration time of an existing items
     * @param expireTime 
     * @param keys Memcached key(s). See FAQ
     */
    gat(expireTime: number|Date = 0, ...keys:string[]): Promise<NotcachedItems> {
        is.numberOrDate(expireTime);
        [...keys].forEach((key) => is.memcachedKey(key));

        return this.command('gat', `gat ${memcachedDate(expireTime)} ${keys.join(' ')}\r\n`) as Promise<NotcachedItems>;
    }
    /**
     * Get and touch with CAS ID. Fetch items and update the expiration time of an existing items
     * @param expireTime 
     * @param keys Memcached key(s). See FAQ
     */
    gats(expireTime: number|Date = 0, ...keys: string[]): Promise<NotcachedItems> {
        is.numberOrDate(expireTime);
        [...keys].forEach((key) => is.memcachedKey(key));

        return this.command('gats', `gats ${memcachedDate(expireTime)} ${keys.join(' ')}\r\n`) as Promise<NotcachedItems>;
    }

    /**
     * Remove everything from server
     * @param delay The delay before the flush operation is carried out
     */
    flushAll(delay: number = 0): Promise<void> {
        ow(delay, ow.number);

        return this.command('flush_all', `flush_all ${delay} \r\n`) as Promise<void>;
    }

    /**
     * Ends the connection
     */
    end(): void {
        this.destroyed = true;
        this.queue.forEach(({ reject }) => reject(new Error('This client is already destroyed.')));
        if (this.socket) this.socket.end();
    }

    /**
     * Executes a storage command
     */
    private execStorageCommand(cmd: string, key: string, flags: number, expireTime: number|Date, value: Buffer|string, cas?: string): Promise<void> {
        is.memcachedKey(key);
        is.bufferOrString(value);
        ow(cmd, ow.string.nonEmpty.alphabetical);
        ow(cas, ow.optional.string.nonEmpty.numeric);
        ow(expireTime, ow.any(ow.number, ow.date));
        ow(flags, ow.number.lessThan(this.MAX_FLAG_SIZE));
        
        const block = Buffer.from(value);
        let commandString = [];
        commandString.push(cmd);
        commandString.push(key);
        commandString.push(flags.toString());
        commandString.push(memcachedDate(expireTime).toString());
        commandString.push(block.length.toString());
        if (cas) commandString.push(cas);
        commandString.push(SEP);

        return this.command(cmd, commandString.join(' '), block) as Promise<void>;
    }

    /**
     * Execute a retrieval command
     * @param cmd 
     * @param keys 
     */
    private execRetrievalCommands(cmd: string, keys: string[]): Promise<NotcachedItems> {
        ow(cmd, ow.string.nonEmpty);
        keys.forEach((key: string) => is.memcachedKey(key));

        let commandString = [];
        commandString.push(cmd);
        commandString = [...commandString, ...keys];
        commandString.push(SEP);

        return this.command(cmd, commandString.join(' ')) as Promise<NotcachedItems>;
    }

    /**
     * Executes a command. This is a low level method used to queue and send data to server
     * @param cmd The command
     * @param cmdString The actual command string sent to server
     * @param block? The data block if any
     */
    private command(commandName: string, command: string, block?: Buffer): Promise<void | NotcachedItems | number> {
        return new Promise((resolve, reject) => {
            let item = {
                commandName,
                command,
                resolve,
                reject
            } as NotcachedQueueItem;
            if (block) item.data = block;
            if (RETRIEVAL_COMMANDS.includes(commandName)) item.replyItems = {};

            this.queue.push(item);
            this.dequeue();
        });
    }

    /**
     * (re)connect to the server
     */
    private connect(retrying?: boolean) {
        if (this.destroyed) return;
        if (retrying && this.retries >= this.options.retries) {
            this.emit('error', new Error('Max retries achieved'));
            return;
        }

        retrying ? this.emit('reconnect') : this.emit('connect');

        const { host, port } = this.location;
        if (this.socket && !this.socket.destroyed) this.socket.destroy();
        this.socket = undefined;

        this.socket = connect(merge({ host, port }, this.options.tcp) as NetConnectOpts);
        if (this.options.timeout !== Infinity) this.socket.setTimeout(this.options.timeout);
        this.socket.once('connect', this.onSocketConnect.bind(this));
        this.socket.once('close', this.onSocketClose.bind(this));
        this.socket.once('error', this.onSocketError.bind(this));
        this.socket.once('timeout', this.onSocketTimeout.bind(this));
        this.socket.on('data', this.onSocketData.bind(this));
        this.connectionTimeout = setTimeout(() => {
            if (this.socket?.connecting) {
                // timed out
                this.emit('connectionTimeout');
                clearTimeout(this.connectionTimeout);
                this.reconnect();
            }
        });
    }

    /**
     * Reconnect to the server
     */
    private reconnect() {
        setTimeout(this.connect.bind(this, true), this.options.retryTime);
    }

    /**
     * For socket `connect` event
     */
    private onSocketConnect() {
        this.emit('ready', this);
    }

    /**
     * For socket `close` event
     * @param hasError
     */
    private onSocketClose(hasError: boolean) {
        if (hasError) {
            this.emit('closed', this.socketError);
        } else {
            this.emit('closed');
        }

        // restart the thing
        this.reconnect();
    }

    /**
     * For socket `error` event
     * @param e 
     */
    private onSocketError(e: Error) {
        this.socketError = e;
        this.emit('error', e);
    }

    /**
     * For socket `timeout` event
     */
    private onSocketTimeout() {
        this.emit('timeout');
        this.socket!.end();
        this.socket!.destroy();
    }

    /**
     * For socket `data` event
     * @param {Buffer} rawData 
     * @private
     */
    private onSocketData(rawData: Buffer) {
        const data = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData);
        // concatenate buffer
        this.socketData.buffer = Buffer.concat([this.socketData.buffer, data]);

        this.processBuffer();
    }

    /**
     * Try to send something from the queue
     */
    private dequeue() {
        if (this.queue.length < 1) return;
        const item = this.queue.shift()!;
        this.currentItem = item;
        
        this.socket!.write(item.command);
        if (this.options.debug) console.log(`Writed: ${inspect(item.command)}`);
        if (item.data) {
            if (this.options.debug) console.log('Writed a block of data');
            this.socket!.write(item.data);
            this.socket!.write(SEP);
        }
    }

    /**
     * Processes the buffer
     */
    private processBuffer() {
        if (this.socketData.expectingBlock) {
            // expecting block, redirect all data to there
            this.socketData.block.data = Buffer.concat([this.socketData.block.data!, this.socketData.buffer]);
            // check if buffer have the block
            this.checkAndVerifyBlock();
            return;
        }

        this.checkReply();
    }

    /**
     * Check and parse command replies
     */
    private checkReply() {
        if (this.socketData.buffer.includes(SEP)) {
            // has delimiter, try to delimit
            const delimiterPos = this.socketData.buffer.indexOf(SEP);
            const messageBeforeSplit = this.socketData.buffer.slice(0, delimiterPos);
            const messageAfterSplit = this.socketData.buffer.slice(delimiterPos + 2);
            this.socketData.buffer = messageAfterSplit;

            // process our new message
            const messagePieces = messageBeforeSplit.toString().split(' ');
            const response = messagePieces.shift()!;
            if (response === 'VALUE') {
                if (this.options.debug) console.log(`Processing block header: ${messagePieces.join(' ')}`)
                // we will expect a data block here
                this.socketData.expectingBlock = true;
                // message format: VALUE <key> <flags> <size> [<cas>] \r\n <block> \r\n
                this.socketData.block.key = messagePieces.shift()!;
                this.socketData.block.flags = parseInt(messagePieces.shift()!);
                this.socketData.block.size = parseInt(messagePieces.shift()!);
                this.socketData.block.cas = messagePieces.shift();
                
                // we can safely assume that `socketData.buffer` contains part of block data
                this.socketData.block.data = this.socketData.buffer;

                // check and verify if buffer has the block
                this.checkAndVerifyBlock();
            } else {
                // just a normal command with no data block
                this.resolveReply([response, ...messagePieces]);
                this.checkReply();
            }
        }
    }

    /**
     * Check if the current buffer holds data for a block.
     * If so, it will extract it
     */
    private checkAndVerifyBlock() {
        // we will check if the current buffer holds our message
        if (this.socketData.block.data!.length >= this.socketData.block.size!) {
            // slice off our block and other data
            const block = this.socketData.buffer.slice(0, this.socketData.block.size!);
            const otherData = this.socketData.buffer.slice(this.socketData.block.size! + 2);
            this.socketData.block.data = block;
            this.socketData.buffer = otherData;
            this.socketData.expectingBlock = false;

            // we will now resolve this block to the request
            this.resolveReply();
            this.checkReply();

        }
    }

    /**
     * Resolves this value to the user via resolving promises associated to it
     * @param response? from server, or undefined for resolving block data
     */
    private resolveReply(response?: string[]) {
        if (this.options.debug) console.log(`Processing: '${response ? response.join(' ') : 'block'}'`)
        if (!response) {
            // this is to resolve a block
            const { key, data, flags, cas } = this.socketData.block;
            // store the item to the current request cache
            let item = {
                data: this.returnBuffer ? Buffer.from(data!) : data!.toString(),
                flags: Number(flags)
            } as NotcachedItem;
            if (cas) item.cas = cas;
            this.currentItem!.replyItems![key!] = item;

            // clear block metadata
            this.socketData.block.key = null;
            this.socketData.block.data = null;
            this.socketData.block.flags = null;
            this.socketData.block.cas = undefined;
            
            // resolve other reply as well
            this.checkReply();
            return;
        }

        let reply = response.shift()!;
        reply = reply.trim();
        switch(reply) {
            case 'END': 
                // end current item peacefully (resolve promise)
                this.currentItem!.resolve(this.currentItem!.replyItems);
                this.dequeue();
                break;
            
            case 'ERROR': {
                const e = new Error('Invalid command name');
                this.emit('error', e);
                this.currentItem!.reject(e);
                break;
            }

            // pretty cool syntax
            case 'CLIENT_ERROR':
            case 'SERVER_ERROR': {
                const e = new Error(response.shift());
                this.emit('error', e);
                this.currentItem!.reject(e);
                break;
            }

            case 'STORED':
            case 'TOUCHED':
            case 'DELETED':
                this.currentItem!.resolve();
                break;
            
            case 'EXISTS':
            case 'NOT_STORED':
            case 'NOT_FOUND':
                this.currentItem!.reject(new Error(reply));
                break;

            case 'OK':
                if (this.currentItem!.commandName === 'flush_all') {
                    this.currentItem!.resolve();
                } else   {
                    const e = new Error(`Unexpected response OK for ${this.currentItem!.commandName}`);
                    this.emit('error', e);
                    this.currentItem!.reject(e);
                }
                break;

            default:
                if (this.currentItem!.commandName.endsWith('cr')) { // incr, decr
                    this.currentItem!.resolve(Number(reply));
                } else {
                    const e = new Error(`Unexpected response: ${response.join(' ')} received`);
                    this.emit('error', e);
                    this.currentItem!.reject(e);
                }
            }
    }

    public on(event: 'error', listener: (e: Error) => void): this;
    public on(event: 'closed', listener: (e?: Error) => void): this;
    public on(event: 'timeout', listener: () => void): this;
    public on(event: 'ready', listener:() => void): this;
    public on(event: 'reconnect', listener: () => void): this;
    public on(event: 'connect', listener: () => void): this;
    public on(event: any, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    public once(event: 'error', listener: (e: Error) => void): this;
    public once(event: 'closed', listener: (e?: Error) => void): this;
    public once(event: 'timeout', listener: () => void): this;
    public once(event: 'ready', listener:() => void): this;
    public once(event: 'reconnect', listener: () => void): this;
    public once(event: 'connect', listener: () => void): this;
    public once(event: any, listener: (...args: any[]) => void): this {
        return super.once(event, listener);
    }
}