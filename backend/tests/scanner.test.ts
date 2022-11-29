import { rmdirSync, unlinkSync } from "fs";
import { open } from "lmdb";
import { Address, newHexValuedId } from "../src/server/graph/global/types";
import { toRadix252 } from "../src/server/graph/global/utils";
import { newScanner } from "../src/server/graph/state/scanner";

describe('scanner', () => {
    function initDb() {
        const testRoot = open('./scannerdb', { name: 'root' });
        const testDB = testRoot.openDB<string, string>({ name: 'mydb' });
        return {
            testRoot, testDB
        }
    }

    function cleanup() {
        try {
            rmdirSync('scannerdb', { recursive: true })
        }
        catch (e) { }
    }

    beforeEach(cleanup)
    afterEach(cleanup)

    it('should scrape RPC API for ERC20 events', () => {
        // Setup junk to talk to RPC API Full node

        // Setup Ethers.js

        // Create a ERC20 Contract object in Ethers.js (see fetch-ethereum.js)

        // Figure out RPC call to grab all events for the contract

        // Figure out how to parse events given the ERC20 ABI (see erc20.json)

        // Write the events in some form to LMDB (see this file for examples)
    })

    it('should scan DB then realtime updates', async () => {
        const { testDB, testRoot } = initDb()
        const keys: string[] = []
        const maxDbSize = 50
        for (let i = 0; i < maxDbSize; i++) {
            const key = newHexValuedId(i.toString(16), 'a') + ":" + toRadix252(Math.round(Math.random() * 1000000))
            keys.push(key)
            testDB.putSync(key, 'true')
        }
        keys.sort()
        expect(testDB.getCount()).toEqual(maxDbSize)

        const scanner = newScanner('test', testRoot, testDB)
        const s = scanner.scan()
        let yieldCount = 0
        while (yieldCount < maxDbSize) {
            const nextScan = (await s.next()).value
            expect(nextScan[0]).toEqual(keys[yieldCount])
            yieldCount++
            if (yieldCount === maxDbSize) {
                expect(keys[maxDbSize - 2]).toEqual(scanner.getScanState()?.lastDbKey)
                expect(scanner.getScanState()?.isSynced).toBeFalsy()

                // With DB exhausted, let's notify of update after 100ms
                const dbExhaustedTime = +new Date()
                const newerNotifiedKey = 'b'
                setTimeout(() => {
                    scanner.notifyUpdate(newerNotifiedKey, "realtime")
                }, 100)
                const realtimeYield = (await s.next()).value
                const realtimeYieldedTime = +new Date()
                expect(dbExhaustedTime + 99).toBeLessThan(realtimeYieldedTime)
                expect(dbExhaustedTime + 160).toBeGreaterThan(realtimeYieldedTime)
                expect(realtimeYield[0]).toEqual(newerNotifiedKey)
                expect(realtimeYield[1]).toEqual("realtime")
                expect(scanner.getScanState()?.lastDbKey).toEqual(newerNotifiedKey)
                expect(scanner.getScanState()?.isSynced).toBeTruthy()

                // Finally, ensure older keys don't change lastDbKey
                const olderKey = 'a'
                setTimeout(() => {
                    scanner.notifyUpdate(olderKey, "realtime2")
                }, 100)
                const realtimeYieldOlder = (await s.next()).value
                expect(realtimeYieldOlder[0]).toEqual(olderKey)
                expect(realtimeYieldOlder[1]).toEqual("realtime2")
                expect(scanner.getScanState()?.lastDbKey).toEqual(newerNotifiedKey)
                return undefined
            }
        }
    })
})
