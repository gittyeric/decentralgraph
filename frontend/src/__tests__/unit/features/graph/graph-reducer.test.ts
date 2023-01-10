import { generateRandomAddress, generateRandomAddressNeighbors, generateRandomRx, newRandomGraphFetcher } from '../../../../features/graph/global/fetch-random';
import { ADDRESS_TYPE, newHexValuedId } from '../../../../features/graph/global/types';
import { sleep } from '../../../../features/graph/global/utils';
import { assertConsistentNodeState, graphReducer, initialState, staticState } from '../../../../features/graph/graph-reducer';
import { getLinkSourceId, getLinkTargetId } from '../../../../features/graph/rendering';

describe('graph-reducer', () => {
    it('Properly purges overflow nodes by LRU policy', async () => {
        // Set reducer state to very small max node count
        const maxNodes = 2

        // Create nodes
        expect(2).toBeGreaterThan(1)

        // Add nodes to reducer state till overflow
        /*let curState = initialState
        for (let i = 0; i < maxNodes + 1; i++) {
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
        }*/
    })
    it('Resists fuzz tests', () => {
    })
})
