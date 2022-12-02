import { abiDatabase, addrDB, contractToCodeHashDB } from "../../lmdb";
import { fetchErc20Details } from "../fetch-ethereum";
import { newScanner } from "./scanner";
import { contractEmitter } from "./scanner-code";

//const debug = instrumentDebug('pools')

// This whitelists interesting contract addresses, the scanner will hunt down
// additional contract address instances that have the same EVM code
export const POOL_LABELS = {
  '0xADDR HERE': {
    labels: ['Uniswap V3']
  }
}

/*export async function scanForPools() {
  debug('Starting Pool Scanner')
  const poolScanner = newScanner('pool', abiDatabase, contractToCodeHashDB)

  // Handle realtime updates
  contractEmitter.on('ContractUpserted', (contract) => {
    poolScanner.notifyUpdate(contract.address.id, contract.code)
  })

  // Ensure all historical state is crawled
  const contractScan = poolScanner.scan()
  for await (let [addrId, c] of contractScan) {
    if (!isAddressId(addrId) || erc20DB.doesExist(addrId)) {
      continue
    }

    const erc20Lookup = await fetchErc20Details(addrId)
    if (erc20Lookup) {
      debug('Token found: ' + JSON.stringify(erc20Lookup, null, 2));
      await erc20DB.put(addrId, erc20Lookup)

      // Refresh and set Addr name in transaction to avoid an overwrite
      addrRelsDB.transactionSync(() => {
        const cursor = startCursor(addrId)
        const freshAddrObj = addrRelsDB.get(cursor) as FullAddress
        if (!freshAddrObj.name) {
          freshAddrObj.name = freshAddrObj.name ?? erc20Lookup.n
          addrRelsDB.put(cursor, freshAddrObj)
        }
      })
    }
  }
}
*/