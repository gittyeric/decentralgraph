import { generateRandomAddress, generateRandomAddressNeighbors, generateRandomRx, generateRandomTransaction, newRandomGraphFetcher } from '../../../../features/graph/global/fetch-random';
import { ADDRESS_TYPE, newHexValuedId, parseHexId } from '../../../../features/graph/global/types';
import { sleep } from '../../../../features/graph/global/utils';
import { assertConsistentNodeState, graphReducer, initialState, staticState } from '../../../../features/graph/graph-reducer';
import { getLinkSourceId, getLinkTargetId } from '../../../../features/graph/rendering';

describe('graph-reducer', () => {
    it('Properly purges overflow nodes by LRU policy', async () => {
        // Set reducer state to very small max node count
        const maxNodes = 3;

        // Create a line of account / transaction nodes to test eviction


        expect(2).toBeGreaterThan(1)

        // Add nodes to reducer state till overflow
        let curState = initialState
        let lastAddress = generateRandomAddress()
        curState = graphReducer(initialState, {
            type: 'NodesLoad',
            nodes: [{
                ...generateRandomAddress(),
                id
            }],
        })
        for (let i = 0; i < maxNodes + 1; i++) {
            const address2 = generateRandomAddress()
            const randomTx = generateRandomTransaction()
            randomTx.from = parseHexId(lastAddress.id)
            randomTx.to = parseHexId(address2.id)



            lastAddress = address2;

            const id = newHexValuedId(i.toString(16), ADDRESS_TYPE)
            curState = graphReducer(initialState, {
                type: 'NodesLoad',
                nodes: [{
                    ...generateRandomAddress(),
                    id
                }],
            })
            const rels = [generateRandomRx(receiverId, txId)]
            curState = graphReducer(curState, {
                type: 'RelsLoad',
                rels: []
            })
            expect(staticState.peekRenderedNodes().length).toEqual(Math.min(maxNodes, i + 1))
            assertConsistentNodeState(maxNodes)
        }
    })
    it('Resists fuzz tests', () => {
    })
})
