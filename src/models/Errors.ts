/**
 * Error thrown when user attempts to use an already destroyed client
 */
export class ClientDestroyedError extends Error {
  constructor () {
    super()
    this.name = 'ClientDestroyedError'
    this.message = 'Client is already destroyed.'
  }
}

/**
 * Thrown when the client no longer tries to retry
 */
export class RetryError extends Error {
  constructor () {
    super()
    this.name = 'RetryError'
    this.message = 'Max retry reached.'
  }
}

/**
 * A base class for other Memcached related error
 */
class MemcachedError extends Error {
    /** The command sent */
    public command: string;
    /** The actual command string sent */
    public sentData: string;
    /** Error code returned by the server */
    public errorCode: string;

    constructor (command: string, sentData: string, errorCode: string) {
      super()
      this.command = command
      this.sentData = sentData
      this.errorCode = errorCode
    }
}

/**
 * Error thrown when an invalid command it sent to the server
 */
export class InvalidCommandError extends MemcachedError {
  constructor (command: string, sentData: string, errorCode: string) {
    super(command, sentData, errorCode)
    this.name = 'InvalidCommandError'
    this.message = 'Invalid command.'
  }
}

/**
 * Error thrown when the server returned an error.
 * Eg. invalid syntax
 */
export class ClientOrServerError extends MemcachedError {
  constructor (command: string, sentData: string, errorCode: string, errorMessage: string) {
    super(command, sentData, errorCode)
    this.name = 'ClientOrServerError'
    this.message = errorMessage
  }
}

/**
 * Error thrown when there is an issue storing the data
 */
export class StoreError extends MemcachedError {
  constructor (command: string, sentData: string, errorCode: string) {
    super(command, sentData, errorCode)
    this.name = 'StoreError'
    this.message = 'Unable to store item.'
  }
}

/**
 * Error thrown when unexpected response is received from the server
 */
export class UnexpectedResponseError extends MemcachedError {
  /**
   * The full reply from the server
   */
    public reply: string;
    constructor (command: string, sentData: string, errorCode: string, reply: string) {
      super(command, sentData, errorCode)
      this.name = 'UnexpectedResponseError'
      this.message = 'Unexpected response received.'
      this.reply = errorCode + ' ' + reply
    }
}
