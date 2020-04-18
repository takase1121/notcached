/**
 * Maximum flag value for legacy servers
 */
export const MAX_LEGACY_FLAG = 0xFFFF;

/**
 * Maximum flag value for newer servers
 */
export const MAX_FLAG = 0xFFFFFF;

/**
 * Maximum expire time before it is assumed to be a UNIX timestamp
 */
export const MAX_EXPIRE_TIME = 60*60*24*30;

/**
 * List of retrieval commands
 */
export const RETRIEVAL_COMMANDS = [
    'get',
    'gets',
    'gat',
    'gats'
]