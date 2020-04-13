const ow = require('ow');

const verifyKey = (key) => {
    if (key.length > 250) return false;
    return key.split('')
        .map(char => char.charCodeAt())
        .every(char => char > 32 && char < 127);
}

const memcachedKey = (key) => {
    return {
        validator: verifyKey(key),
        message: 'Memcached key must not include control characters or spaces'
    };
}

exports.verifyKey = verifyKey;

exports.memcachedDate = (date) => {
    const unixTime = date instanceof Date ? date.getTime() : date;
    return Math.round(unixTime/1000); // js Unix time is in milliseconds, memcached uses seconds
}

exports.is = {
    bufferOrString: ow.default.create(ow.default.any( ow.default.string, ow.default.buffer )),
    numberOrDate  : ow.default.create(ow.default.any( ow.default.number, ow.default.date )),
    memcachedKey: ow.default.create(memcachedKey)
};


