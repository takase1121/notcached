const merge = require('deepmerge');
const { connect } = require('net');
const { EventEmitter } = require('events');

class Notcached extends EventEmitter {
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
            retry: 3000,
            timeout: 3000,
            tcp: {},
            legacyFlags: true
        };

        this.options = merge(defaultOptions, options);

        this.MAX_FLAG_SIZE = this.options.legacyFlags ? 0xFFFF : 0xFFFFFF;
        this.socketError = null;
        this.socketData = {
            buffer: Buffer.alloc(0),
            expectingBlock: false,
            block: {
                size: 0,
                flags: null,
                key: null,
                data: null
            }
        };

        this.queue = [];
        this.currentItem = null;


        const [host, port] = connectionString.split(':');
        this.socket = connect(merge({ host, port }, this.options.tcp));;
        this.socket.setTimeout(this.options.timeout);
        this.socket.once('connect', this.onSocketConnect.bind(this));
        this.socket.once('close', this.onSocketClose.bind(this));
        this.socket.once('error', this.onSocketError.bind(this));
        this.socket.once('timeout', this.onSocketTimeout.bind(this));
        this.socket.on('data', this.onSocketData.bind(this));
    }

    /**
     * Store something into the server
     * @param {string} key 
     * @param {string|Buffer} value 
     * @param {number} [flags=0]
     * @param {number|Date} [expireTime=0]
     */
    set(key, value, expireTime = 0, flags = 0) {
        if (!Notcached.verifyKey(key)) throw new Error('Invalid key');
        if (!Buffer.isBuffer(value) && typeof value !== 'string') throw new Error('Value must be buffer or string');
        if (isNaN(expireTime) && !(expireTime instanceof Date)) throw new Error('Expire time must be number Date object');
        if (flags > this.MAX_FLAG_SIZE) throw new Error('The flag must be smaller than 2^16 or 2^32');

        let expTime = null;
        if (expTime instanceof Date) {
            expTime = expireTime;
        } else {
            expTime = (expireTime/1000) > (60*60*24*30) ? new Date(expireTime) : new Date(Date.now() + expireTime);
        }
        // TODO: optimize this block
        const block = Buffer.from(value);
        const data = [
            Buffer.from('set'),
            Buffer.from(' '),
            Buffer.from(key),
            Buffer.from(' '),
            Buffer.from(flags.toString()),
            Buffer.from(' '),
            Buffer.from(Math.round(expTime.getTime() / 1000)),
            Buffer.from(' '),
            Buffer.from(block.length.toString()),
            Buffer.from(' '),
            Buffer.from('\r\n'),
            block,
            Buffer.from('\r\n')
        ];

        return this.command('get', Buffer.concat(data));
    }

    /**
     * Executes a command. This is a low level method used to queue and send data to server
     * @param {string} cmd 
     * @param {Buffer} data 
     */
    command(cmd, data) {
        return new Promise((resolve, reject) => {
            const item = {
                cmd,
                resolve,
                reject,
                data
            };

            this.queue.push(item);
            this.dequeue();
        });
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
        const data = Buffer.isBuffer(rawData) ? rawData.toString('utf8') : rawData;
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
        
        this.socket.write(item.data);
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
                // message format: VALUE <key> <flags> <size> \r\n <block> \r\n
                this.socketData.block.key = messagePieces.shift();
                this.socketData.block.flags = messagePieces.shift();
                this.socketData.block.size = messagePieces.shift();

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
            const { key, data, flags } = this.socketData.block;
            // store the item to the current request cache
            this.currentItem.items[key] = { data: Buffer.from(data), flags: Number(flags) };
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

    /**
     * Verify if the key is valid (no control character, no space)
     * @param {string} key 
     */
    static verifyKey(key) {
        if (key.length > 250) return false;
        return key.split('')
            .map(char => char.charCodeAt())
            .every(char => char > 32 && char < 127);
    }
}