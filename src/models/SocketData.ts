import { BlockData } from './BlockData' // eslint-disable-line no-unused-vars

export interface SocketData {
    buffer: Buffer;
    expectingBlock: boolean;
    block: BlockData
};
