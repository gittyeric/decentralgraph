import { rmdirSync, unlinkSync } from "fs";
import { open } from "lmdb";
import { Address, newHexValuedId } from "../src/server/graph/global/types";
import { toRadix252 } from "../src/server/graph/global/utils";
import { newScanner } from "../src/server/graph/state/scanner";

describe('scanner', () => {
    function initDb() {
        const testRoot = open('./testdb', { name: 'root' });
        const testDB = testRoot.openDB<string, string>({ name: 'mydb' })
        return {
            testRoot, testDB, resetDb: async () => {
                await testDB.flushed
                await testDB.close()
                return testRoot.openDB<string, string>({ name: 'mydb' })
            }
        }
    }

    function cleanup() {
        try {
            rmdirSync('testdb', { recursive: true })
        }
        catch (e) {}
    }

    beforeEach(cleanup)
    afterEach(cleanup)

    it('should support ordered radix252 key puts and getRanges', async () => {
        let { testDB, testRoot, resetDb } = initDb()
        const keys: string[] = []
        const c = 1000
        for (let i = 0; i < c; i++) {
            const key = newHexValuedId(i.toString(16), 'a') + ":" + toRadix252(Math.round(Math.random() * 1000000))
            keys.push(key)
            testDB.putSync(key, 'true')
        }
        expect(testDB.getCount()).toEqual(c)

        keys.sort()
        testDB = await resetDb()
        let j = 0
        for (const { key, value } of testDB.getRange({})) {
            expect(typeof (key)).toEqual('string')
            expect(typeof (value)).toEqual('string')
            const match = keys[j]
            try {
                expect(key).toEqual(match)
            } catch (e) {
                throw e
            }
            j++
        }

        const scanner = newScanner('test', testRoot, testDB)
        const s = scanner.scan()
        let count = 0
        for await (const x of s) {
            if (x[1]) {
                count++
            }
            expect(count).toBeGreaterThan(0)
            if (count === c)
                break
        }

    })
    it('should batch puts properly', async () => {
        const {testDB} = initDb()
        const keyVals: string[] = []
        for (let i = 0; i < 5000; i++) {
            keyVals.push(toRadix252(i * 100000))
        }
        await testDB.batch(() => {
            for (const keyval of keyVals) {
                testDB.put(keyval, keyval)
            }
        })
        expect(testDB.getCount()).toEqual(5000)
        keyVals.reverse()
        for (const keyval of keyVals) {
            expect(testDB.get(keyval)).toEqual(keyval)
        }
    })
    it('should resume from a key that doesnt exist', async () => {
        const {testDB} = initDb()
        const keyVals: string[] = []
        for (let i = 1; i < 50; i+=2) {
            keyVals.push(toRadix252(i * 100000))
        }
        testDB.putSync('0:0:0', '0:0:0')
        testDB.putSync('0:1:1', '0:1:1')
        testDB.putSync('3:0:3', '3:0:3')

        const seen: string[] = []
        for (const k of testDB.getKeys({
            start: '0:0:1'
        })) {
            seen.push(k)
        }

        expect(seen).toEqual(['0:1:1', '3:0:3'])
    })
})
