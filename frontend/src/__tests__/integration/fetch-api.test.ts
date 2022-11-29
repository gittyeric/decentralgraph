import { sleep } from '../../features/graph/global/utils';
import { fetchNode, fetchTimeline } from '../../features/graph/graph-algos'
import {remoteFetcher } from '../../features/graph/graph-fetchers'

describe('fetch-api', () => {
    it.skip('should fetch timeline', async () => {
        const gen = fetchTimeline('a,', remoteFetcher)
        const batch = [] as string[]
        for await(const t of gen) {
            batch.push(...t)
        }
        expect(batch.length).toBeGreaterThan(2)
    });
    it('go', async () => {
        const gen = fetchNode(remoteFetcher, 'a,')
        await sleep(2000)
        const batch = [] as unknown[]
        for await(const t of gen) {
            console.log('batch!')
            batch.push(...t)
        }
        expect(batch.length).toBeGreaterThan(1)
    })
})
