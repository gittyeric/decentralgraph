import { ScalableBloomFilter } from "bloom-filters";
import { addrDatabase, addrDB, ensDB } from "../../lmdb";
import { fetchEnsName } from "../fetch-ethereum";
import { FullAddress, parseHexId } from "../../../../../frontend/src/features/graph/global/types";
import { instrumentDebug } from "../../../../../frontend/src/features/graph/global/utils";
import { addressEmitter } from "./core-init";
import { newScanner } from "./scanner";

const debug = instrumentDebug('ens')

export async function scanForEns() {
  const ensScanner = newScanner('ens', addrDatabase, addrDB)

  // Handle realtime updates
  addressEmitter.on('AddressUpserted', (address) => {
    ensScanner.notifyUpdate(address.id, address)
  })

  const ensMaybeSeen = new ScalableBloomFilter()

  debug('Starting ENS Scanner')

  // Ensure all historical state is crawled
  const ensScan = ensScanner.scan()
  for await (let [addrKey, addrObj] of ensScan) {
    if (
      // TODO: Consider TTL too somehow and store record deadline
      // TODO(low): Switch to just this first line one day? When it comes to ENS ttls this would be preferrable
      // to remembering forever
      ensMaybeSeen.has(addrObj.id) ||
      (addrObj.name && ensDB.doesExist(addrObj.name))) {
      continue
    }
    try {
      const ensLookup = await fetchEnsName(parseHexId(addrObj.id));
      ensMaybeSeen.add(addrObj.id)
      if (ensLookup) {
        debug(ensLookup);

        // Refresh and set Addr name in transaction to avoid an overwrite
        const tx = addrDB.transaction(() => {
          const freshAddrObj = addrDB.get(addrKey) as FullAddress
          freshAddrObj.name = freshAddrObj.name ?? ensLookup;
          addrDB.putSync(addrKey, freshAddrObj)
        })
        const put = ensDB.put(ensLookup, addrObj.id);
        await Promise.all([tx, put])
      }
    } catch (e) {
      debug(JSON.stringify((e as Error).stack))
      //throw e
    }
  }
}
