import ow from 'ow'

const memcachedKey = (key: string) => {
  return {
    validator: verifyKey(key),
    message: 'Memcached key must not include control characters or spaces'
  }
}

/**
 * Verify a string whether if it is a valid memcached key
 * @param key
 */
export const verifyKey = (key: string) => {
  if (key.length > 250) return false
  return key.split('')
    .map(char => char.charCodeAt(0))
    .every(char => char > 32 && char < 127)
}

/**
 * Normalizes a number or `Date` object to a valid memcached date
 * @param date
 */
export const memcachedDate = (date: number|Date) => {
  const unixTime = date instanceof Date ? date.getTime() : date
  return Math.round(unixTime / 1000) // js Unix time is in milliseconds, memcached uses seconds
}

/**
 * `setTimeout` for `async/await`
 * @param ms The time to wait in Millisecondds
 */
export function asyncWait (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * An object with validator functions to validate stuff
 */
export const is = {
  bufferOrString: ow.create(ow.any(ow.string, ow.buffer)),
  numberOrDate: ow.create(ow.any(ow.number, ow.date)),
  memcachedKey: ow.create(ow.string.nonEmpty.validate(memcachedKey)),
  locationString: ow.create(ow.string.nonEmpty.matches(/(.+):(\d+)/))
}
