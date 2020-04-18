import { BlockData } from './BlockData' // eslint-disable-line no-unused-vars

/**
 * A structure to store data from socket
 */
export interface SocketData {
    /**
     * Main buffer used to store raw data received by socket
     */
    buffer: Buffer;
    /**
     * Determines whether a block is being received
     */
    expectingBlock: boolean;
    /**
     * Block data
     */
    block: BlockData
};
