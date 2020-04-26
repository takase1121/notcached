import ow from 'ow'
import merge from 'deepmerge'
import { inspect } from 'util'
import { EventEmitter } from 'events'
import { connect, Socket, NetConnectOpts } from 'net'

import { is, memcachedDate } from './Util'
import { MemcachedClient } from './models/MemcachedClient'
import { NotcachedOptions } from './models/NotcachedOptions'
import { NotcachedItem, NotcachedItems } from './models/NotcachedItem'
import { NotcachedQueue, NotcachedQueueItem } from './models/NotcachedQueue'
import { mergeDefaultOptions } from './models/NotcachedDefaultOptions'
import { SocketData } from './models/SocketData'
import {
  ClientDestroyedError,
  ClientOrServerError,
  InvalidCommandError,
  RetryError,
  StoreError,
  UnexpectedResponseError
} from './models/Errors'
import {
  MAX_FLAG,
  MAX_LEGACY_FLAG,
  RETRIEVAL_COMMANDS,
  SEP,
  RETURN_TYPE
} from './Constants'

/**
 * Creates a Notcached client.
 * This is just a wrapper over `Notcached`'s constructor
 * @param location Location of the memcached server, eg: `127.0.0.1:11211`
 * @param options Options
 */
export function createClient (location: string, options?: Partial<NotcachedOptions>) {
  return new Notcached(location, options)
}

/**
 * A memcached client. A single connection to a single server
 */
export class Notcached extends EventEmitter implements MemcachedClient {
    /** location of the memcached server */
    public readonly location: { host: string, port: number };
    /** Client options */
    public readonly options: NotcachedOptions;
    /** If this is true, this client can no longer be used */
    public destroyed: boolean;

    /** Flag size. See FAQ */
    protected MAX_FLAG_SIZE: number;
    /** Socket error, if any */
    protected socketError?: Error;
    /** Socket state */
    protected socketData: SocketData;
    /** Number of retries */
    protected retries: number;
    /** Queue */
    protected queue: NotcachedQueue;
    /** Current processing item */
    protected currentItem?: NotcachedQueueItem;
    /** The socket */
    protected socket?: Socket;
    /** Determines whether to return buffer or string */
    protected returnedData: RETURN_TYPE;
    /** Timeout object for the socket */
    protected connectionTimeout: any;

    /**
     * Creates a Notcached client.
     * @param location Location of the memcached server, eg: `127.0.0.1:11211`
     * @param options Options
     */
    constructor (location: string, options?: Partial<NotcachedOptions>) {
      super()
      is.locationString(location)

      this.options = mergeDefaultOptions(options)
      this.MAX_FLAG_SIZE = this.options.legacyFlags ? MAX_LEGACY_FLAG : MAX_FLAG

      this.socketData = {
        buffer: Buffer.alloc(0),
        expectingBlock: false,
        block: {
          size: 0,
          flags: 0,
          key: null,
          data: null
        }
      }

      this.retries = 0
      this.queue = new NotcachedQueue()
      this.destroyed = false
      this.returnedData = RETURN_TYPE.BUFFER
      this.connectionTimeout = null

      const [host, port] = location.split(':')
      this.location = { host, port: Number(port) }

      this.connect()
    }

    /**
     * Changes the return type of data
     * @param type
     */
    returnType (type: RETURN_TYPE): this {
      this.returnedData = type
      return this
    }

    /**
     * If called, the proceeding requests will return Buffer instances
     */
    buffer () {
      this.returnedData = RETURN_TYPE.BUFFER
      return this
    }

    /**
     * If called, the proceeding requests will return strings
     */
    string () {
      this.returnedData = RETURN_TYPE.STRING
      return this
    }

    /**
     * Store something into the server
     * @param key Memcached key. See FAQ
     * @param value The data to store
     * @param expireTime Expiration date. Defaults to never (0) See FAQ
     * @param flags Flags to store the data with. See FAQ
     */
    set (key: string, value: Buffer|string, expireTime: number|Date = 0, flags: number = 0): Promise<void> {
      return this.execStorageCommand('set', key, flags, expireTime, value)
    }

    /**
     * Store something only if the server don't have it
     * @param key Memcached key. See FAQ
     * @param value The data to store
     * @param expireTime Expiration date. Defaults to never (0) See FAQ
     * @param flags Flags to store the data with. See FAQ
     */
    add (key: string, value: Buffer|string, expireTime: number|Date = 0, flags: number = 0): Promise<void> {
      return this.execStorageCommand('add', key, flags, expireTime, value)
    }

    /**
     * Store something only if the server have it
     * @param key Memcached key. See FAQ
     * @param value The data to store
     * @param expireTime Expiration date. Defaults to never (0) See FAQ
     * @param flags Flags to store the data with. See FAQ
     */
    replace (key: string, value: Buffer|string, expireTime: number|Date = 0, flags: number = 0): Promise<void> {
      return this.execStorageCommand('replace', key, flags, expireTime, value)
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
    cas (key: string, value: Buffer|string, cas: string, expireTime: number|Date = 0, flags: number = 0): Promise<void> {
      return this.execStorageCommand('cas', key, flags, expireTime, value, cas)
    }

    /**
     * Append onto existing data
     * @param key Memcached key. See FAQ
     * @param value The data to store
     */
    append (key: string, value: Buffer|string): Promise<void> {
      return this.execStorageCommand('append', key, 0, 0, value)
    }

    /**
     * Prepend onto existing data
     * @param key Memcached key. See FAQ
     * @param value
     */
    prepend (key: string, value: Buffer|string): Promise<void> {
      return this.execStorageCommand('prepend', key, 0, 0, value)
    }

    /**
     * Get something / a lot of things
     * @param keys Memcached key. See FAQ
     */
    get (...keys: string[]): Promise<NotcachedItems> {
      return this.execRetrievalCommands('get', [...keys])
    }

    /**
     * Get something / a lot of things with their CAS ID
     * @param keys Memcached key. See FAQ
     */
    gets (...keys: string[]): Promise<NotcachedItems> {
      return this.execRetrievalCommands('gets', [...keys])
    }

    /**
     * Delete something
     * @param key Memcached key. See FAQ
     */
    delete (key: string): Promise<void> {
      is.memcachedKey(key)
      return this.command('delete', `delete ${key} \r\n`) as Promise<void>
    }

    /**
     * Increment something
     * @param key Memcached key. See FAQ
     * @param value The value to increment
     */
    incr (key: string, value: number = 1): Promise<number> {
      is.memcachedKey(key)
      ow(value, ow.number.greaterThanOrEqual(1))
      return this.command('incr', `incr ${key} ${value} \r\n`) as Promise<number>
    }

    /**
     * Decrement something
     * @param key Memcached key. See FAQ
     * @param value The value to decrement
     */
    decr (key: string, value: number = 1): Promise<number> {
      is.memcachedKey(key)
      ow(value, ow.number.greaterThanOrEqual(1))
      return this.command('decr', `decr ${key} ${value} \r\n`) as Promise<number>
    }

    /**
     * Touch a key (Updating their expiration date)
     * @param key Memcached key. See FAQ
     * @param expireTime
     */
    touch (key: string, expireTime: number|Date = 0): Promise<void> {
      is.memcachedKey(key)
      is.numberOrDate(expireTime)
      return this.command('touch', `touch ${key} ${memcachedDate(expireTime)} \r\n`) as Promise<void>
    }

    /**
     * Get and touch. Fetch items and update the expiration time of an existing items
     * @param expireTime
     * @param keys Memcached key(s). See FAQ
     */
    gat (expireTime: number|Date = 0, ...keys:string[]): Promise<NotcachedItems> {
      is.numberOrDate(expireTime);
      [...keys].forEach((key) => is.memcachedKey(key))

      return this.command('gat', `gat ${memcachedDate(expireTime)} ${keys.join(' ')}\r\n`) as Promise<NotcachedItems>
    }

    /**
     * Get and touch with CAS ID. Fetch items and update the expiration time of an existing items
     * @param expireTime
     * @param keys Memcached key(s). See FAQ
     */
    gats (expireTime: number|Date = 0, ...keys: string[]): Promise<NotcachedItems> {
      is.numberOrDate(expireTime);
      [...keys].forEach((key) => is.memcachedKey(key))

      return this.command('gats', `gats ${memcachedDate(expireTime)} ${keys.join(' ')}\r\n`) as Promise<NotcachedItems>
    }

    /**
     * Remove everything from server
     * @param delay The delay before the flush operation is carried out
     */
    flushAll (delay: number = 0): Promise<void> {
      ow(delay, ow.number)

      return this.command('flush_all', `flush_all ${delay} \r\n`) as Promise<void>
    }

    /**
     * Flushes the queue. Returns a promise that will be fullfilled once queue is empty.
     */
    flushQueue (): Promise<void> {
      return new Promise(resolve => this.queue.size === 0 ? resolve() : this.queue.once('empty', resolve))
    }

    /**
     * Ends the connection
     */
    async end (flush: boolean = false) {
      if (flush) await this.flushQueue()
      this.destroyed = true
      this.queue.destroy(({ reject }) => reject(new ClientDestroyedError()))
      if (this.socket) this.socket.end()
    }

    /**
     * Executes a storage command
     */
    protected execStorageCommand (cmd: string, key: string, flags: number, expireTime: number|Date, value: Buffer|string, cas?: string): Promise<void> {
      if (this.destroyed) throw new ClientDestroyedError()

      is.memcachedKey(key)
      is.bufferOrString(value)
      ow(cmd, ow.string.nonEmpty.alphabetical)
      ow(cas, ow.optional.string.nonEmpty.numeric)
      ow(expireTime, ow.any(ow.number, ow.date))
      ow(flags, ow.number.lessThan(this.MAX_FLAG_SIZE))

      const block = Buffer.from(value)
      const commandString = []
      commandString.push(cmd)
      commandString.push(key)
      commandString.push(flags.toString())
      commandString.push(memcachedDate(expireTime).toString())
      commandString.push(block.length.toString())
      if (cas) commandString.push(cas)
      commandString.push(SEP)

      return this.command(cmd, commandString.join(' '), block) as Promise<void>
    }

    /**
     * Execute a retrieval command
     * @param cmd
     * @param keys
     */
    protected execRetrievalCommands (cmd: string, keys: string[]): Promise<NotcachedItems> {
      if (this.destroyed) throw new ClientDestroyedError()

      ow(cmd, ow.string.nonEmpty)
      keys.forEach((key: string) => is.memcachedKey(key))

      let commandString = []
      commandString.push(cmd)
      commandString = [...commandString, ...keys]
      commandString.push(SEP)

      return this.command(cmd, commandString.join(' ')) as Promise<NotcachedItems>
    }

    /**
     * Executes a command. This is a low level method used to queue and send data to server
     * @param cmd The command
     * @param cmdString The actual command string sent to server
     * @param block? The data block if any
     */
    protected command (commandName: string, command: string, block?: Buffer): Promise<void | NotcachedItems | number> {
      if (this.destroyed) throw new ClientDestroyedError()
      return new Promise((resolve, reject) => {
        const item = {
          commandName,
          command,
          resolve,
          reject
        } as NotcachedQueueItem
        if (block) item.data = block
        if (RETRIEVAL_COMMANDS.includes(commandName)) item.replyItems = {}

        this.queue.push(item)
        this.dequeue()
      })
    }

    /**
     * (re)connect to the server
     */
    protected connect (retrying?: boolean) {
      if (this.destroyed) return
      if (retrying && this.retries >= this.options.retries) {
        this.emit('error', new RetryError())
        return
      }

      retrying ? this.emit('reconnect') : this.emit('connect')

      const { host, port } = this.location
      if (this.socket && !this.socket.destroyed) this.socket.destroy()
      this.socket = undefined

      this.socket = connect(merge({ host, port }, this.options.tcp) as NetConnectOpts)
      if (this.options.timeout !== Infinity) this.socket.setTimeout(this.options.timeout)
      this.socket.once('connect', this.onSocketConnect.bind(this))
      this.socket.once('close', this.onSocketClose.bind(this))
      this.socket.once('error', this.onSocketError.bind(this))
      this.socket.once('timeout', this.onSocketTimeout.bind(this))
      this.socket.on('data', this.onSocketData.bind(this))
      this.connectionTimeout = setTimeout(() => {
        if (this.socket?.connecting) {
          // timed out
          this.emit('connectionTimeout')
          clearTimeout(this.connectionTimeout)
          this.reconnect()
        }
      })
    }

    /**
     * Reconnect to the server
     */
    protected reconnect () {
      setTimeout(this.connect.bind(this, true), this.options.retryTime)
    }

    /**
     * For socket `connect` event
     */
    protected onSocketConnect () {
      this.emit('ready', this)
    }

    /**
     * For socket `close` event
     * @param hasError
     */
    protected onSocketClose (hasError: boolean) {
      if (hasError) {
        this.emit('closed', this.socketError)
      } else {
        this.emit('closed')
      }

      // restart the thing
      this.reconnect()
    }

    /**
     * For socket `error` event
     * @param e
     */
    protected onSocketError (e: Error) {
      this.socketError = e
      this.emit('error', e)
    }

    /**
     * For socket `timeout` event
     */
    protected onSocketTimeout () {
      this.emit('timeout')
        this.socket!.end()
        this.socket!.destroy()
    }

    /**
     * For socket `data` event
     * @param {Buffer} rawData
     * @private
     */
    protected onSocketData (rawData: Buffer) {
      const data = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData)
      // concatenate buffer
      this.socketData.buffer = Buffer.concat([this.socketData.buffer, data])

      this.processBuffer()
    }

    /**
     * Try to send something from the queue
     */
    protected dequeue () {
      if (this.queue.size === 0) return
      const item = this.queue.shift()!
      this.currentItem = item

        this.socket!.write(item.command)
        if (this.options.debug) this.log(`Writed: ${inspect(item.command)}`)
        if (item.data) {
          if (this.options.debug) this.log('Writed: a block of data')
            this.socket!.write(item.data)
            this.socket!.write(SEP)
        }
    }

    /**
     * Processes the buffer
     */
    protected processBuffer () {
      if (this.socketData.expectingBlock) {
        // expecting block, redirect all data to there
        this.socketData.block.data = Buffer.concat([this.socketData.block.data!, this.socketData.buffer])
        // check if buffer have the block
        this.checkAndVerifyBlock()
        return
      }

      this.checkReply()
    }

    /**
     * Check and parse command replies
     */
    protected checkReply () {
      if (this.socketData.buffer.includes(SEP)) {
        // has delimiter, try to delimit
        const delimiterPos = this.socketData.buffer.indexOf(SEP)
        const messageBeforeSplit = this.socketData.buffer.slice(0, delimiterPos)
        const messageAfterSplit = this.socketData.buffer.slice(delimiterPos + 2)
        this.socketData.buffer = messageAfterSplit

        // process our new message
        const messagePieces = messageBeforeSplit.toString().split(' ')
        const response = messagePieces.shift()!
        if (response === 'VALUE') {
          if (this.options.debug) this.log(`Processing: a block header: ${messagePieces.join(' ')}`)
          // we will expect a data block here
          this.socketData.expectingBlock = true
          // message format: VALUE <key> <flags> <size> [<cas>] \r\n <block> \r\n
          this.socketData.block.key = messagePieces.shift()!
          this.socketData.block.flags = parseInt(messagePieces.shift()!)
          this.socketData.block.size = parseInt(messagePieces.shift()!)
          this.socketData.block.cas = messagePieces.shift()

          // we can safely assume that `socketData.buffer` contains part of block data
          this.socketData.block.data = this.socketData.buffer

          // check and verify if buffer has the block
          this.checkAndVerifyBlock()
        } else {
          // just a normal command with no data block
          this.resolveReply([response, ...messagePieces])
          this.checkReply()
        }
      }
    }

    /**
     * Check if the current buffer holds data for a block.
     * If so, it will extract it
     */
    protected checkAndVerifyBlock () {
      // we will check if the current buffer holds our message
      if (this.socketData.block.data!.length >= this.socketData.block.size!) {
        // slice off our block and other data
        const block = this.socketData.buffer.slice(0, this.socketData.block.size!)
        const otherData = this.socketData.buffer.slice(this.socketData.block.size! + 2)
        this.socketData.block.data = block
        this.socketData.buffer = otherData
        this.socketData.expectingBlock = false

        // we will now resolve this block to the request
        this.resolveReply()
        this.checkReply()
      }
    }

    /**
     * Resolves this value to the user via resolving promises associated to it
     * @param response? from server, or undefined for resolving block data
     */
    protected resolveReply (response?: string[]) {
      if (this.options.debug) this.log(`Processing: ${response ? "'" + response.join(' ') + "'" : 'block'}`)
      if (!response) {
        // this is to resolve a block
        const { key, data, flags, cas } = this.socketData.block
        // store the item to the current request cache
        const item = {
          data: this.returnedData === RETURN_TYPE.BUFFER ? Buffer.from(data!) : data!.toString(),
          flags: Number(flags)
        } as NotcachedItem
        if (cas) item.cas = cas
            this.currentItem!.replyItems![key!] = item

            // clear block metadata
            this.socketData.block.key = null
            this.socketData.block.data = null
            this.socketData.block.flags = null
            this.socketData.block.cas = undefined

            // resolve other reply as well
            this.checkReply()
            return
      }

      let reply = response.shift()!
      let other = response.join(' ')
      reply = reply.trim()
      other = other.trim()
      switch (reply) {
        case 'END':
                // end current item peacefully (resolve promise)
                this.currentItem!.resolve(this.currentItem!.replyItems)
          this.dequeue()
          break

        case 'ERROR': {
          const e = new InvalidCommandError(this.currentItem!.commandName, this.currentItem!.command, reply)
          this.emit('error', e)
                this.currentItem!.reject(e)
                break
        }

        // pretty cool syntax
        case 'CLIENT_ERROR':
        case 'SERVER_ERROR': {
          const e = new ClientOrServerError(this.currentItem!.commandName, this.currentItem!.command, reply, other)
          this.emit('error', e)
                this.currentItem!.reject(e)
                break
        }

        case 'STORED':
        case 'TOUCHED':
        case 'DELETED':
                this.currentItem!.resolve()
          break

        case 'EXISTS':
        case 'NOT_STORED':
        case 'NOT_FOUND':
                this.currentItem!.reject(new StoreError(this.currentItem!.commandName, this.currentItem!.command, reply))
          break

        case 'OK':
          if (this.currentItem!.commandName === 'flush_all') {
                    this.currentItem!.resolve()
          } else {
            const e = new UnexpectedResponseError(this.currentItem!.commandName, this.currentItem!.command, reply, '')
            this.emit('error', e)
                    this.currentItem!.reject(e)
          }
          break

        default:
          if (this.currentItem!.commandName.endsWith('cr')) { // incr, decr
                    this.currentItem!.resolve(Number(reply))
          } else {
            const e = new UnexpectedResponseError(this.currentItem!.commandName, this.currentItem!.command, reply, other)
            this.emit('error', e)
                    this.currentItem!.reject(e)
          }
      }
    }

    /**
     * Internal method called when logging is necessary. Only for debug
     * @param message
     */
    protected log (message: string): void {
      this.emit('debug', message)
      if (typeof this.options.debug === 'function') {
        this.options.debug(message)
      } else {
        console.log(message)
      }
    }

    public on(event: 'error', listener: (e: Error) => void): this;
    public on(event: 'closed', listener: (e?: Error) => void): this;
    public on(event: 'timeout', listener: () => void): this;
    public on(event: 'ready', listener:() => void): this;
    public on(event: 'reconnect', listener: () => void): this;
    public on(event: 'connect', listener: () => void): this;
    public on(event: 'debug', listener: (message: string) => void): this;
    public on (event: any, listener: (...args: any[]) => void): this {
      return super.on(event, listener)
    }

    public once(event: 'error', listener: (e: Error) => void): this;
    public once(event: 'closed', listener: (e?: Error) => void): this;
    public once(event: 'timeout', listener: () => void): this;
    public once(event: 'ready', listener:() => void): this;
    public once(event: 'reconnect', listener: () => void): this;
    public once(event: 'connect', listener: () => void): this;
    public once(event: 'debug', listener: (message: string) => void): this;
    public once (event: any, listener: (...args: any[]) => void): this {
      return super.once(event, listener)
    }
}
