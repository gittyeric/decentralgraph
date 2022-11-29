import { AddressObjs, BlockObjs, Err, FETCH_ERRORS, GraphCursor, NodeErr, StateObjs, TransObjs } from './fetch-contract.js';
import { Address, Block, GraphNodes, GraphObjs, Transaction } from './types.js';
import { newContract } from 'socket-generator';

export interface ServerToClientEvents {
  responsePartial: (requestId: string, objs: unknown) => void
  responseComplete: (requestId: string, ret?: unknown, err?: unknown) => void
  broadcastState: (s: StateObjs | GraphObjs) => void
}

export interface ClientToServerEvents {
  fetchNode: (requestId: string, id: GraphNodes['id']) => void
  fetchAddressRels: (requestId: string, cursor: GraphCursor) => void
  fetchAddressTimeline: (id: Address['id']) => void
}

export interface SocketData {
  uid: string
}

export const addressContract = newContract<[
  cursor: GraphCursor,
  includeNode: boolean,
], AddressObjs[], undefined | NodeErr>('fetchAddressRels');

export const addressTimelineContract = newContract<[
  id: Address['id']
], GraphCursor[], undefined | NodeErr>('fetchAddressTimeline');

export const blockContract = newContract<[
  id: Block['id'],
], BlockObjs[], undefined | NodeErr>('fetchBlock');

export const transactionContract = newContract<[
  id: Transaction['id'],
], TransObjs[], undefined | NodeErr>('fetchTransaction');

export const serverPushContract = newContract<[], never, StateObjs | Err<FETCH_ERRORS.NETWORK_ERROR>>(
  'requestServerPush');
