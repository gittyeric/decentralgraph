import { Database, Key, RootDatabase } from "lmdb";
import memoizee from "memoizee";
import { coreLogger } from "../../../util";
import { isShuttingDown } from "../../server-utils";
import { instrumentDebug } from "../../../../../frontend/src/features/graph/global/utils";

type ScanState<K extends string> = {
    lastDbKey: K,
    isSynced: boolean,
    count: number,
}

/**
 * A scanner guarantees over an entire DB and yields key/values from it
 * while tracking realtime inserts (as long as you plumb updates to notifyUpdate!).
 * Since it also listens for realtime updates, it never returns, just waits around
 * for more updates after catching up to realtime.
 * @param name A unique name, used to track current iteration state over restarts
 * @param sourceDb The sourceDB to iterate over, after exhaustion only yields realtime updates
 * @returns 
 */
export function newScanner<K extends string, V>(name: string, sourceRootDb: RootDatabase, sourceDb: Database<V, K>, restart: boolean = false) {
    const debug = instrumentDebug(`scanner-${name}`, [coreLogger.info, console.log])
    const scanDb = sourceRootDb.openDB<ScanState<K>, string>({
        name: `scanner_${name}`,
    })
    const stateKey = `__scan-${name}`
    const realtimeInserts: [K, V][] = []
    if (restart) {
        scanDb.removeSync(stateKey)
    }
    const loaded = scanDb.get(stateKey) as ScanState<K> | undefined
    let lastDbKey: K | undefined = loaded?.lastDbKey as K
    let count: number = loaded?.count || 0
    let insertTrigger = Promise.resolve()
    let continueScan = () => { }

    async function* drainRealtime(isRealtime: boolean): AsyncGenerator<[K, V], undefined, undefined> {
        while (realtimeInserts.length > 0) {
            const recentInsert = realtimeInserts.pop()!
            if (isRealtime) {
                const latestKeys = [recentInsert[0], lastDbKey]
                latestKeys.sort()
                lastDbKey = latestKeys[1]
                count++
                await scanDb.put(stateKey, {
                    lastDbKey: lastDbKey,
                    isSynced: true,
                    count,
                } as ScanState<K>)
            }
            yield recentInsert
        }
        return undefined
    }

    async function* scan(): AsyncGenerator<[K, V], never, undefined> {
        debug(`Scanning ${name}, progress: ${count}`)
        let iter = sourceDb.getRange(lastDbKey ? { start: lastDbKey } : {})
        let s = 0
        for (const { key, value } of iter) {
            if (typeof (key) === "string") {
                const curDbKey = key as K
                if (curDbKey === lastDbKey) {
                    continue
                }
                lastDbKey = curDbKey
                yield [lastDbKey, value]
                count++

                await scanDb.put(stateKey, {
                    lastDbKey,
                    isSynced: false,
                    count
                } as ScanState<K>)

                yield* drainRealtime(false)

                // Stop if shutting down after processing realtime entries
                if (isShuttingDown()) {
                    debug(`Bailing early @ count ${count}`)
                    //@ts-ignore : This "never" returns in practice except this rare case
                    return
                }
            } else {
                debug(key)
                throw new Error(`unknown key type in ${name}? ` + typeof (key) +
                    '\n' + JSON.stringify(key))
            }
        }

        debug(`${name} scanner is realtime`)

        while (true) {
            await insertTrigger
            insertTrigger = new Promise((res, rej) => {
                continueScan = res
            })

            yield* drainRealtime(true)
            // Stop if shutting down after processing realtime entries
            if (isShuttingDown()) {
                debug(`Bailing early @ count ${count}`)
                //@ts-ignore : This "never" returns in practice except this rare case
                return
            }
        }
    }

    return {
        notifyUpdate: (k: K, v: V) => {
            realtimeInserts.push([k.toString() as K, v])
            // Signal to scan generator to continue if paused
            continueScan()
        },
        // Scans over entire history then catches up to realtime
        // Never returns, just pauses till notifyUpdate is called
        scan,
        getScanState: () => scanDb.get(stateKey),
    }
}
