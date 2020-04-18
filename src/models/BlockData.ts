export interface BlockData {
    size: number | null;
    key: string | null;
    cas?: string; 
    flags: number | null;
    data: Buffer | null;
}