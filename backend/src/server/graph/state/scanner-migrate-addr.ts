import { ScalableBloomFilter } from "bloom-filters";
import { addrDB, addrRelsDB, ensDB, ethRelsDatabase } from "../../lmdb";
import { fetchEnsName } from "../fetch-ethereum";
import { GraphCursor, parseCursor, startCursor } from "../../../../../frontend/src/features/graph/global/fetch-contract";
import { Address, FullAddress, isFullAddress, parseHexId } from "../../../../../frontend/src/features/graph/global/types";
import { instrumentDebug, sleep } from "../../../../../frontend/src/features/graph/global/utils";
import { newScanner } from "./scanner";

const debug = instrumentDebug('ens')

export async function scanForMigration() {
    const migrateScanner = newScanner('addrMigrate', ethRelsDatabase, addrRelsDB)

    debug('Starting Migration')

    let removeBatch: GraphCursor[] = []

    setInterval(() => {
        for (const r of removeBatch) {
            addrRelsDB.remove(r)
        }
        removeBatch = []
    }, 20000)

    // Ensure all historical state is crawled
    const migrateScan = migrateScanner.scan()
    for await (let [addrKey, addrObj] of migrateScan) {
        if (!isFullAddress(addrObj)) {
            continue
        }
        const id = parseCursor(addrKey).id
        addrDB.putSync(id, addrObj)
        removeBatch.push(addrKey)
    }
}
