const merge = require('deepmerge');
const ow = require('ow');
const { connect } = require('net');
const { EventEmitter } = require('events');
const { inspect } = require('util');

const { MAX_FLAG, MAX_LEGACY_FLAG } = require('./Constants');
const { is, memcachedDate } = require('./Util');

module.exports = class Notcached extends EventEmitter {
    /**
     * Constructs a single socket to a memcached server
     * @param {string} connectionString 
     * @param {*} options
     */
    constructor(connectionString, options = {}) {
        super();
        if (!connectionString.match(/(.+):(\d+)$/)) {
            throw new Error('Server path must be "ip:port"');
        }

        const defaultOptions = {
            debug: false,
            retries: 3,
            retryTime: 3000,
            timeout: 3000,
            tcp: {},
            legacyFlags: true
        };

        this.options = merge(defaultOptions, options);
        this.MAX_FLAG_SIZE = this.options.legacyFlags ? MAX_LEGACY_FLAG : MAX_FLAG;
        
        this.socketError = null;
        this.socketData = {
            buffer: Buffer.alloc(0),
            expectingBlock: false,
            block: {
                size: 0,
                flags: null,
                key: null,
                data: null,
                cas: null
            }
        };

        this.retries = 0;

        this.queue = [];
        this.currentItem = null;

        this.socket = null;

        const [host, port] = connectionString.split(':');
        this.location = { host, port };

        this.connect();
    }

    /**
     * Store something into the server
     * @param {string} key Memcached key. See [Memcached keys]{@link memcached_tips#key}
     * @param {string|Buffer} value The data to store
     * @param {number|Date} [expireTime=0] Expiration date. Defaults to never (0) See [memcached dates]{@link memcached_tips#date}
     * @param {number} [flags=0] Flags to store the data with. See [Flags]{@link memcached_tips#flags}
     */
    set(key, value, expireTime = 0, flags = 0) {
        return this.execStorageCommand('set', key, flags, expireTime, value);
    }

    /**
     * Store something only if the server don't have it
     * @param {string} key Memcached key. See [Memcached keys]{@link memcached_tips#key}
     * @param {string|Buffer} value The data to store
     * @param {number|Date} [expireTime=0] Expiration date. Defaults to never (0) See [memcached dates]{@link memcached_tips#date}
     * @param {number} [flags=0] Flags to store the data with. See [Flags]{@link memcached_tips#flags}
     */
    add(key, value, expireTime = 0, flags = 0) {
        return this.execStorageCommand('add', key, flags, expireTime, value);
    }

    /**
     * Store something only if the server have it
     * @param {string} key Memcached key. See [Memcached keys]{@link memcached_tips#key}
     * @param {string|Buffer} value The data to store
     * @param {number|Date} [expireTime=0] Expiration date. Defaults to never (0) See [memcached dates]{@link memcached_tips#date}
     * @param {number} [flags=0] Flags to store the data with. See [Flags]{@link memcached_tips#flags}
     */
    replace(key, value, expireTime = 0, flags = 0) {
        return this.execStorageCommand('replace', key, flags, expireTime, value);
    }

    /**
     * A "check and set" operation.
     * "Store something only if someone else did not update it since last time I fetched it"
     * @param {string} key Memcached key. See [Memcached keys]{@link memcached_tips#key}
     * @param {string|Buffer} value The data to store
     * @param {string} cas CAS ID. Usually you get this ID via `gets`
     * @param {number|Date} [expireTime=0] Expiration date. Defaults to never (0) See [memcached dates]{@link memcached_tips#date}
     * @param {number} [flags=0] Flags to store the data with. See [Flags]{@link memcached_tips#flags}
     */
    cas(key, value, cas, expireTime = 0, flags = 0) {
        return this.execStorageCommand('cas', key, flags, expireTime, value, cas);
    }

    /**
     * Append onto existing data
     * @param {string} key Memcached key. See [Memcached keys]{@link memcached_tips#key}
     * @param {string|Buffer} value The data to store
     */
    append(key, value) {
        return this.execStorageCommand('append', key, null, null, value);
    }

    /**
     * Prepend onto existing data
     * @param {string} key Memcached key. See [Memcached keys]{@link memcached_tips#key}
     * @param {stirng|Buffer} value 
     */
    prepend(key, value) {
        return this.execStorageCommand('prepend', key, null, null, value);
    }

    /**
     * Get something / a lot of things
     * @param  {...string} keys Memcached key. See [Memcached keys]{@link memcached_tips#key}
     */
    get(...keys) {
        return this.execRetrievalCommands('get', [...keys]);
    }

    /**
     * Get something / a lot of things with their CAS ID
     * @param  {...string} keys Memcached key. See [Memcached keys]{@link memcached_tips#key}
     */
    gets(...keys) {
        return this.execRetrievalCommands('gets', [...keys]);
    }

    /**
     * Delete something
     * @param {string} key Memcached key. See [Memcached keys]{@link memcached_tips#key}
     */
    delete(key) {
        is.memcachedKey(key);
        return this.command('delete', `delete ${key} \r\n`);
    }

    /**
     * Increment something
     * @param {string} key Memcached key. See [Memcached keys]{@link memcached_tips#key}
     * @param {number} [value=1] The value to increment
     */
    incr(key, value = 1) {
        is.memcachedKey(key);
        ow(value, ow.default.number.greaterThanOrEqual(1));
        return this.command('incr', `incr ${key} ${value} \r\n`);
    }

    /**
     * Decrement something
     * @param {string} key Memcached key. See [Memcached keys]{@link memcached_tips#key}
     * @param {number} [value=1] The value to decrement
     */
    decr(key, value = 1) {
        is.memcachedKey(key);
        ow(value, ow.default.number.greaterThanOrEqual(1));
        return this.command('decr', `decr ${key} ${value} \r\n`);
    }

    /**
     * Touch a key (Updating their expiration date)
     * @param {string} key Memcached key. See [Memcached keys]{@link memcached_tips#key}
     * @param {number|Date} [expireTime=0]
     */
    touch(key, expireTime = 0) {
        is.memcachedKey(key);
        is.numberOrDate(expireTime);
        return this.command('touch', `touch ${key} ${memcachedDate(expireTime)} \r\n`);
    }

    /**
     * Get and touch. Fetch items and update the expiration time of an existing items
     * @param {number|Date} expireTime 
     * @param  {...string} keys Memcached key(s). See [Memcached keys]{@link memcached_tips#key}
     */
    gat(expireTime, ...keys) {
        is.numberOrDate(expireTime);
        [...keys].forEach(is.memcachedKey);

        return this.command('gat', `gat ${keys.join(' ')}\r\n`);
    }
    /**
     * Get and touch with CAS ID. Fetch items and update the expiration time of an existing items
     * @param {number|Date} expireTime 
     * @param  {...string} keys Memcached key(s). See [Memcached keys]{@link memcached_tips#key}
     */
    gats(expireTime, ...keys) {
        is.numberOrDate(expireTime);
        [...keys].forEach(is.memcachedKey);

        return this.command('gats', `get ${keys.join(' ')}\r\n`);
    }

    /**
     * Executes a storage command
     * @param {string} cmd 
     * @param {string} key 
     * @param {number} flags 
     * @param {number|Date} expireTime 
     * @param {string|Buffer} value 
     * @param {string} cas
     */
    execStorageCommand(cmd, key, flags, expireTime, value, cas) {
        is.memcachedKey(key);
        is.bufferOrString(value);
        ow(cmd, ow.default.string.nonEmpty);
        ow(cas, ow.default.optional.string.nonEmpty.numeric);
        ow(expireTime, ow.default.any(is.numberOrDate, ow.default.null));
        ow(flags, ow.default.any(ow.default.number.lessThan(this.MAX_FLAG_SIZE), ow.default.null));
        
        const block = Buffer.from(value);
        let commandString = [];
        commandString.push(key);
        if (flags !== null) commandString.push(flags.toString());
        if (expireTime !== null) commandString.push(memcachedDate(expireTime).toString());
        commandString.push(block.length.toString());
        if (cas) commandString.push(cas);
        commandString.push('\r\n');

        return this.command(cmd, commandString.join(' '), block);
    }

    /**
     * Execute a retrieval command
     * @param {string} cmd 
     * @param {string[]} keys 
     */
    execRetrievalCommands(cmd, keys) {
        ow(cmd, ow.default.string.nonEmpty);
        ow(keys, ow.default.array.nonEmpty.ofType(is.memcachedKey));

        let commandString = [];
        commandString.push(key);
        commandString = [...commandString, ...keys];
        commandString.push('\r\n');

        return this.command(cmd, commandString.join(' '));
    }

    /**
     * Executes a command. This is a low level method used to queue and send data to server
     * @param {string} cmd The command
     * @param {string} cmdString The actual command string sent to server
     * @param {Buffer} [block] The data block if any
     */
    command(cmd, cmdString, block) {
        return new Promise((resolve, reject) => {
            let item = {
                cmd,
                resolve,
                reject,
                cmdString
            };
            if (block) item.block = block;

            this.queue.push(item);
            this.dequeue();
        });
    }

    /**
     * (re)connect to the server
     * @private
     */
    connect(retrying) {
        if (retrying && this.retries >= this.options.retries) {
            this.emit('error', new Error('Max retries achieved'));
            return;
        }

        const { host, port } = this.location;

        if (this.socket && !this.socket.destroyed) this.socket.destroy();
        this.socket = null;

        this.socket = connect(merge({ host, port }, this.options.tcp));;
        this.socket.setTimeout(this.options.timeout);
        this.socket.once('connect', this.onSocketConnect.bind(this));
        this.socket.once('close', this.onSocketClose.bind(this));
        this.socket.once('error', this.onSocketError.bind(this));
        this.socket.once('timeout', this.onSocketTimeout.bind(this));
        this.socket.on('data', this.onSocketData.bind(this));
    }

    /**
     * For socket `connect` event
     * @private
     */
    onSocketConnect() {
        this.emit('ready', this);
    }

    /**
     * For socket `close` event
     * @param {boolean} hasError
     * @private 
     */
    onSocketClose(hasError) {
        if (hasError) {
            this.emit('closed', this.socketError);
        } else {
            this.emit('closed');
        }

        // restart the thing
        setTimeout(this.connect.bind(this, true), this.options.retry);
    }

    /**
     * For socket `error` event
     * @param {Error} e 
     * @private
     */
    onSocketError(e) {
        this.socketError = e;
        this.emit('error', e);
    }

    /**
     * For socket `timeout` event
     * @private
     */
    onSocketTimeout() {
        this.emit('timeout');
        this.socket.end();
        this.socket.destroy();;
    }

    /**
     * For socket `data` event
     * @param {Buffer} rawData 
     * @private
     */
    onSocketData(rawData) {
        const data = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData);
        // concatenate buffer
        this.socketData.buffer = Buffer.concat([this.socketData.buffer, data]);

        this.processBuffer();
    }

    /**
     * Try to send something from the queue
     * @private
     */
    dequeue() {
        if (this.queue.length < 1) return;
        const item = this.queue.shift();
        this.currentItem = item;
        
        this.socket.write(item.cmdString);
        if (this.options.debug) console.log(`Writed: ${inspect(item.cmdString)}`);
        if (item.block) {
            this.socket.write(item.block);
            this.socket.write('\r\n');
        }
    }

    /**
     * Processes the buffer
     * @private
     */
    processBuffer() {
        if (this.socketData.expectingBlock) {
            // expecting block, redirect all data to there
            this.socketData.block.data = Buffer.concat([this.socketData.block.data, this.socketData.buffer]);
            // check if buffer have the block
            this.checkAndVerifyBlock();

            return;
        }

        if (this.socketData.buffer.includes('\r\n')) {
            // has delimiter, try to delimit
            const delimiterPos = this.socketData.buffer.indexOf('\r\n');
            const messageBeforeSplit = this.socketData.buffer.slice(0, delimiterPos);
            const messageAfterSplit = this.socketData.buffer.slice(delimiterPos + 2);
            this.socketData.buffer = messageAfterSplit;

            // process our new message
            const messagePieces = messageBeforeSplit.toString().split(' ');
            const response = messagePieces.shift();
            if (response === 'VALUE') {
                // we will expect a data block here
                this.socketData.expectingBlock = true;
                // message format: VALUE <key> <flags> <size> [<cas>] \r\n <block> \r\n
                this.socketData.block.key = messagePieces.shift();
                this.socketData.block.flags = messagePieces.shift();
                this.socketData.block.size = messagePieces.shift();
                this.socketData.block.cas = messagePieces.shift();

                // we can safely assume that `socketData.buffer` contains part of block data
                this.socketData.block.data = this.socketData.buffer;

                // check and verify if buffer has the block
                this.checkAndVerifyBlock();
            } else {
                // just a normal command with no data block
                this.resolveReply([response, ...messagePieces]);
            }
        }
    }

    /**
     * Check if the current buffer holds data for a block.
     * If so, it will extract it
     * @private
     */
    checkAndVerifyBlock() {
        // we will check if the current buffer holds our message
        if (this.socketData.block.data >= this.socketData.block.size) {
            // slice off our block and other data
            const block = this.socketData.buffer.slice(0, this.socketData.block.size);
            const otherData = this.socketData.buffer.slice(this.socketData.block.size);
            this.socketData.block.data = block;
            this.socketData.buffer = otherData;
            this.socketData.expectingBlock = false;

            // we will now resolve this block to the request
            this.resolveReply();
        }
    }

    /**
     * Resolves this value to the user via resolving promises associated to it
     * @param {string[]} [response] Response from server, or undefined for resolving block data
     * @private
     */
    resolveReply(response) {
        if (!response) {
            // this is to resolve a block
            const { key, data, flags, cas } = this.socketData.block;
            // store the item to the current request cache
            let item = {
                data: Buffer.from(data),
                flags: Number(flags)
            }
            if (cas) item.cas = cas;
            this.currentItem.items[key] = item;
            return;
        }

        const reply = response.shift();
        switch(reply) {
            case 'END': 
                // end current item peacefully (resolve promise)
                this.currentItem.resolve(this.currentItem.items);
                break;
            
            case 'ERROR': {
                const e = new Error('Invalid command name');
                this.emit('error', e);
                this.currentItem.reject(e);
                break;
            }

            // pretty cool syntax
            case 'CLIENT_ERROR':
            case 'SERVER_ERROR': {
                const e = new Error(response.shift());
                this.emit('error', e);
                this.currentItem.reject(e);
                break;
            }

            case 'STORED':
            case 'TOUCHED':
            case 'DELETED':
                this.currentItem.resolve(true);
                break;
            
            case 'EXISTS':
            case 'NOT_STORED':
            case 'NOT_FOUND':
                this.currentItem.reject(reply);
                break;

            default:
                if (this.currentItem.command.endsWith('cr')) { // incr, decr
                    this.currentItem.resolve(Number(reply));
                } else {
                    const e = new Error(`Unexpected response: ${response.join(' ')} received`);
                    this.emit('error', e);
                    this.currentItem.reject(e);
                }
        }

        // ready for next request
        this.dequeue();
    }
}