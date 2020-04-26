import { NotcachedOptions } from './NotcachedOptions' // eslint-disable-line no-unused-vars
import merge from 'deepmerge'

/**
 * Default options used by Notcached client
 */
export const defaultOptions: NotcachedOptions = {
  debug: false,
  retries: 3,
  retryTime: 3000,
  timeout: Infinity,
  connectionTimeout: 3000,
  tcp: {},
  legacyFlags: true
}

/**
 * Merges anything with the default Notcached client option
 * @param obj
 */
export function mergeDefaultOptions (obj?: any): NotcachedOptions {
  return merge(obj || {}, defaultOptions)
}
