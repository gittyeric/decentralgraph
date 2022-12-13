import stringHash from "string-hash";
import { Address, AddressRelations, Block, BlockRelations, EChainState, FullAddress, FullBlock, FullTransaction, GraphNodes, isPaginatedNodeId, PaginatedNode, Relations, Transaction, TransactionRelations } from './types';
import { fromRadix252, toRadix252 } from './utils';

// Need to start fetching fresh results from here
export const MAX_ADDRESS_AGE_TILL_STALE = 1000 * 60 * 60 * 32;

export type GraphCursor = `${PaginatedNode['id']};${string};${string}`
export enum FETCH_ERRORS {
    NODE_NOT_EXISTS = 1,
    NETWORK_ERROR = 2
}

function createCursor(id: PaginatedNode['id'], timeRadix252: string, hash: number): GraphCursor {
    return `${id};${timeRadix252};${toRadix252(hash)}`;
}

export function isGraphCursor(cursor: string): cursor is GraphCursor {
    try {
        const parsed = parseCursor(cursor as GraphCursor);
        if (isPaginatedNodeId(parsed.id as GraphNodes['id']) && isFinite(parsed.timeMs)) {
            return true;
        }
    } catch (e) { }
    return false;
}

export function toCursor(id: PaginatedNode['id'], startingFrom: Relations): GraphCursor {
    // Create a 16 bit hash of the relation that excludes info about 'id' since the
    // first part of the cursor includes this, same for timestamp.  The hash simply
    // ensures that the cursor is unique by (addrId, ts, relType, otherAddrId) tuple.
    // Using a hash greatly shrinks storage (like needing otherAddrId) while (almost) guaranteeing
    // that every rel has 1 unique cursor backing it
    return createCursor(id, startingFrom.ts, Math.round(stringHash(startingFrom.id.replace(id, '')) / 2))
}

export const startCursor = (id: PaginatedNode['id']) => createCursor(id, toRadix252(0), 0);

export type ParsedCursor = {
    id: PaginatedNode['id'],
    timeMs: number,
    hash: number,
}
export function parseCursor(cursor: GraphCursor): ParsedCursor {
    const split = cursor.split(';')
    return {
        id: split[0] as PaginatedNode['id'],
        timeMs: Number(fromRadix252(split[1])) * 1000,
        hash: Number(fromRadix252(split[2])),
    }
}

export type Err<ETYPES extends number> = {
    // Error code
    c: ETYPES,
    // User display msg
    usr: string,
    // Debug string
    db?: string,
}
export type NodeErr = Err<
    FETCH_ERRORS.NODE_NOT_EXISTS |
    FETCH_ERRORS.NETWORK_ERROR
>

export function isErr(obj: any): obj is Err<FETCH_ERRORS> {
    return typeof (obj) === 'object' && typeof ((obj as Err<FETCH_ERRORS>).c) !== 'undefined';
}

// Returns true if end of pagination is reached
// Returns false if more pages can be loaded
export type AddressObjs = FullAddress | AddressRelations;
export type BlockObjs = FullBlock | FullAddress | Transaction | FullTransaction | BlockRelations | TransactionRelations;
export type TransObjs = FullTransaction | FullBlock | TransactionRelations;
export type StateObjs = EChainState;
export type AddressObjsGenerator = AsyncGenerator<AddressObjs[], undefined | NodeErr, undefined>
export type AddressTimelineGenerator = AsyncGenerator<GraphCursor[], undefined | NodeErr, undefined>
export type BlockObjsGenerator = AsyncGenerator<BlockObjs[], undefined | NodeErr, undefined>
export type TransObjsGenerator = AsyncGenerator<TransObjs[], undefined | NodeErr, undefined>
export type ServerPushGenerator = AsyncGenerator<never, StateObjs | Err<FETCH_ERRORS.NETWORK_ERROR>, undefined>

export type RequestAddressTimeline = (id: Address['id']) => AddressTimelineGenerator
export type RequestAddressRels = (cursor: GraphCursor, includeAddress: boolean) => AddressObjsGenerator
export type RequestBlock = (id: Block['id']) => BlockObjsGenerator
export type RequestTransaction = (id: Transaction['id']) => TransObjsGenerator
export type RequestServerPush = () => ServerPushGenerator

export type GraphFetcher = {
    fetchAddressTimeline: RequestAddressTimeline,
    fetchAddressRels: RequestAddressRels,
    fetchBlock: RequestBlock,
    fetchTransaction: RequestTransaction,
    requestServerPush: RequestServerPush,
}
