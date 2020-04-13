/**
 * Maximum flag value for legacy servers
 * @type {number}
 */
exports.MAX_LEGACY_FLAG = 0xFFFF;

/**
 * Maximum flag value for newer servers
 */
exports.MAX_FLAG = 0xFFFFFF;

/**
 * Maximum expire time before it is assumed to be a UNIX timestamp
 */
exports.MAX_EXPIRE_TIME = 60*60*24*30;