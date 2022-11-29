import { Endpoint } from 'socket-generator';
import { Socket as ServerSocket } from 'socket.io';
import { addressContract, addressTimelineContract, blockContract, serverPushContract, transactionContract } from '../../../../frontend/src/features/graph/global/api-contracts';
import { GraphFetcher } from '../../../../frontend/src/features/graph/global/fetch-contract';
import { instrumentDebug } from '../../../../frontend/src/features/graph/global/utils';

const debug = instrumentDebug('respond-ws')

export function wireEndpointsToSocket(socket: ServerSocket, endpoints: Endpoint[]) {
  debug(`connection open ${socket.handshake.address}`)
  socket.once('disconnect', (e) => {
    debug(`connection closed ${socket.handshake.address}`)
  })
  for (const endpoint of endpoints) {
    endpoint.bindClient(socket)
  }
}

export function newContractEndpoints(rootFetcher: GraphFetcher) {
  return {
    addressTimelineEndpoint: addressTimelineContract.newEndpoint(rootFetcher.fetchAddressTimeline),
    addressEndpoint: addressContract.newEndpoint(rootFetcher.fetchAddressRels),
    blockEndpoint: blockContract.newEndpoint(rootFetcher.fetchBlock),
    transactionEndpoint: transactionContract.newEndpoint(rootFetcher.fetchTransaction),
    serverPushEndpoint: serverPushContract.newEndpoint(rootFetcher.requestServerPush),
  }
}