# Memcached FAQ

Here are some FAQ regarding Memcached.


## Memcached Keys

Memcached keys must not contain spaces and control characters (`0x00`-`0x1F`).
Quoting from [memcached itself](https://github.com/memcached/memcached/wiki/Commands#standard-protocol):
> A key (arbitrary string up to 250 bytes in length. No space or newlines for ASCII mode)

## Memcached Expire Times

Memcached expire times are intervals in seconds or a UNIX timestamp. How do we determine this?

- If a it is smaller or equal to 30 days (`60 * 60 * 24 * 30`), it is intepreted as an interval in seconds.
- If a it is larger than 30 days (`60 * 60 * 24 * 30`), it is intepreted as a UNIX timestamp.

Quoting from [memcached itself](https://github.com/memcached/memcached/wiki/Commands#standard-protocol):
> An expiration time, in seconds. '0' means never expire. Can be up to 30 days. After 30 days, is treated as a unix timestamp of an exact date.

## Memcached Flags

Even though the [documentation](https://github.com/memcached/memcached/wiki/Commands#standard-protocol) says that a flag is a 32-bit unsigned integer:
> A 32bit "flag" value

But the [protocol documentation](https://github.com/memcached/memcached/blob/master/doc/protocol.txt) says otherwise:
> `flags` is an arbitrary 16-bit unsigned integer (written out in
>  decimal) that the server stores along with the data and sends back
>  when the item is retrieved. Clients may use this as a bit field to
>  store data-specific information; this field is opaque to the server.
>  Note that in memcached 1.2.1 and higher, flags may be 32-bits, instead
>  of 16, but you might want to restrict yourself to 16 bits for
>  compatibility with older versions.

This is why I introduced `options.legacyFlags`. This defaults to `true` so that compatibility with older servers is kept. Checks will be performed to the flag to make sure it is compliant to `options.legacyFlags`.