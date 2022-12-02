import { fetchTimeline } from '../../features/graph/graph-algos'
import {remoteFetcher } from '../../features/graph/graph-fetchers'

describe('fetch-api', () => {
    it('should fetch timeline', async () => {
        const gen = fetchTimeline('a,', remoteFetcher)
        const batch = [] as string[]
        for await(const t of gen) {
            batch.push(...t)
        }
        expect(batch.length).toBeGreaterThan(2)
    });
})
