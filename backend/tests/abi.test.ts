import {execAsync, shrunkenSha1 } from '../src/util'

describe('hashing and exec', () => {
    it('echo + sha256 should work', async () => {
        const {stdout} = await execAsync('echo hello')
        expect(stdout).toEqual('hello')
        const hashed = shrunkenSha1(stdout)
        expect(hashed.length).toBeLessThan(30)
    })
})
