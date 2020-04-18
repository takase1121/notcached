import ow from 'ow';

const memcachedKey = (key: string) => {
    return {
        validator: verifyKey(key),
        message: 'Memcached key must not include control characters or spaces'
    };
}
export const verifyKey = (key: string) => {
    if (key.length > 250) return false;
    return key.split('')
        .map(char => char.charCodeAt(0))
        .every(char => char > 32 && char < 127);
}

export const memcachedDate = (date: number|Date) => {
    const unixTime = date instanceof Date ? date.getTime() : date;
    return Math.round(unixTime/1000); // js Unix time is in milliseconds, memcached uses seconds
}

export function asyncWait(ms: number) {
    return new Promise(res => setTimeout(res, ms));
}

export const is = {
    bufferOrString: ow.create(ow.any( ow.string, ow.buffer )),
    numberOrDate  : ow.create(ow.any( ow.number, ow.date )),
    memcachedKey: ow.create(ow.string.nonEmpty.validate(memcachedKey))
};