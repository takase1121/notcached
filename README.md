# Notcached
A Node.js Memcached client.

After using the `memcached` package, I was dissatisfied by it. `memcached` does not support promises and its not maintained anymore.
Even the fork `memecached` doesn't seem to be maintained either. So, I decided to write my own client instead.


### Features
- [x] Basic commands, eg. get, set
- [x] Pool for a single server
- [ ] Multiple server support with [ketama algorithm](https://www.metabrew.com/article/libketama-consistent-hashing-algo-memcached-clients)
- [ ] Meta commands
- [ ] Binary support
- [ ] SASL support
- [ ] Stream support (node.js `stream`)
