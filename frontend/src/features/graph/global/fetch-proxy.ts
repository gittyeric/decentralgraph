import { Socket } from "socket.io-client";
import { addressContract, addressTimelineContract, blockContract, serverPushContract, transactionContract } from './api-contracts.js';
import { GraphFetcher } from './fetch-contract.js';

export function newWsProxyFetcher(clientSocket: Socket): GraphFetcher {
    const addressClient = addressContract.newClient(clientSocket, 10000)
    const addressTimelineClient = addressTimelineContract.newClient(clientSocket, 10000)
    const blockClient = blockContract.newClient(clientSocket, 10000)
    const transactionClient = transactionContract.newClient(clientSocket, 10000)
    const serverPushClient = serverPushContract.newClient(clientSocket, Number.POSITIVE_INFINITY)

    return {
        fetchAddressRels: addressClient,
        fetchAddressTimeline: addressTimelineClient,
        fetchBlock: blockClient,
        fetchTransaction: transactionClient,
        requestServerPush: serverPushClient,
    } as GraphFetcher
}
