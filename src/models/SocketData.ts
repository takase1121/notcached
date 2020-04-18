import { BlockData } from './BlockData'

export interface SocketData {
    buffer: Buffer;
    expectingBlock: boolean;
    block: BlockData
};