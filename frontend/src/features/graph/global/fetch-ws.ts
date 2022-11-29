import { io, Socket } from 'socket.io-client'
import {
  addressContract,
  addressTimelineContract,
  blockContract,
  ClientToServerEvents,
  serverPushContract,
  ServerToClientEvents,
  transactionContract
} from './api-contracts'
import { Err, FETCH_ERRORS, GraphFetcher } from './fetch-contract'
import { Address, Block, Transaction } from './types'
import { instrumentDebug } from './utils'

const debug = instrumentDebug('fetch-ws')

let socket: Socket<ServerToClientEvents, ClientToServerEvents>

function getSocketClient(
  url: string
): Socket<ServerToClientEvents, ClientToServerEvents> {
    if (!socket) {
      debug(`Attempting socket connection to ${url}`)
      socket = io(url)
      socket.connect()
      debug(`Called socket.connect()`)

      socket.once('connect', () => {
        debug('Connected to ' + url)
      })
    }
    return socket
}

// Convert thrown inner gen errors to app-layer Err's
async function* convertToErr<T, RETURN, NEXT>(gen: AsyncGenerator<T, RETURN, NEXT>) {
  while (true) {
    try {
      const next = await gen.next()
      if (next.done) {
        return next.value
      }
      yield next.value
    } catch (e) {
      return {
        c: FETCH_ERRORS.NETWORK_ERROR,
        db: (e as Error).message,
      } as Err<FETCH_ERRORS.NETWORK_ERROR>
    }
  }
}

export const newWsFetcher = function newWsFetcher(url: string, clientTimeout: number): GraphFetcher {
  const boundSocket = getSocketClient(url)

  const fetchAddressRels = addressContract.newClient(boundSocket, clientTimeout)
  const fetchAddressTimeline = addressTimelineContract.newClient(boundSocket, clientTimeout)
  const fetchBlock = blockContract.newClient(boundSocket, clientTimeout)
  const fetchTransaction = transactionContract.newClient(boundSocket, clientTimeout)
  const requestServerPush = serverPushContract.newClient(boundSocket, clientTimeout)

  const fetcher: GraphFetcher = {
    fetchAddressRels: (cursor, includeNode) =>
      convertToErr(fetchAddressRels(cursor, includeNode)),
    fetchAddressTimeline: (id: Address['id']) => convertToErr(fetchAddressTimeline(id)),
    fetchBlock: (id: Block['id']) => convertToErr(fetchBlock(id)),
    fetchTransaction: (id: Transaction['id']) => convertToErr(fetchTransaction(id)),
    requestServerPush: requestServerPush,
  }
  return fetcher
}
