# Notcached
A Node.js Memcached client.

After using the `memcached` package, I was dissatisfied. `memcached` does not support promises and its not maintained anymore.
Even the fork `memecached` doesn't seem to be maintained either. So, I decided to write my own client instead.

### Features
- [x] Basic commands, eg. get, set
- [x] Pool for a single server
- [ ] Multiple server support with [ketama algorithm](https://www.metabrew.com/article/libketama-consistent-hashing-algo-memcached-clients)
- [ ] Meta commands
- [ ] Binary support
- [ ] SASL support
- [ ] Stream support (node.js `stream`)

### Documentations
[Here.](https://takase1121.github.io/notcached)

### Examples
```js
const { Notcached, createPool } = require('notcached');
const MEMCACHED_SERVER_LOCATION = 'localhost:11211';

const client = new Notcached(SERVER_LOCATION, {
    debug: false,
    retries: 3,  // number of retries before giving up
    retryTime: 3000, // time in milliseconds to wait before the client attempt to reconnect
    timeout: Infinity, // socket timeout, better leave this Infinity
    connectionTimeout: 3000, // time in milliseconds the before client tries to reconnect
    tcp: {}, // tcp options. Usually you don't need to specify this
    legacyFlags: true // leave this to true for backwards compatibility. Please see FAQ
});

// make sure results are returned in strings
client.string();

// setting something
await client.set('hey', 'hello world!', 0, 12);

// getting something
const val = await client.get('hey');
console.log(val); // prints: { 'hey': { data: 'hello world!', flags: 12 } }

const pool = createPool(MEMCACHED_SERVER_LOCATION, { min: 2, max: 10 }); // the pool options accept tarn.js options

const connection = await pool.acquire().promise;

// do things with this connection

// release it
pool.release(pool);
```

This is some examples for common usages of the library. For more info, visit the [documentation](https://takase1121.github.io/notcached).

> Please note that the pooling capabilities of this library comes from [tarn.js](https://github.com/Vincit/tarn.js). You should visit them for more examples on how to use the pool.


### Memcached FAQ
[See memcached FAQ](https://github.com/takase1121/notcached/blob/master/FAQ.md)