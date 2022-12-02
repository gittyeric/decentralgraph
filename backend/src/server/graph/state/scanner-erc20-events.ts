import { abiDatabase, addrRelsDB, codeHashToContractsDB, erc20DB, ethRelsDatabase } from "../../lmdb";
import { fetchErc20Details } from "../fetch-ethereum";
import { startCursor, toCursor } from "../../../../../frontend/src/features/graph/global/fetch-contract";
import { Address, FullAddress, getSourceDestFromRel, isAddressId, isGraphNode, isRx, isTx, parseHexId, Rx, Transaction, Tx } from "../../../../../frontend/src/features/graph/global/types";
import { instrumentDebug, sleep } from "../../../../../frontend/src/features/graph/global/utils";
import { addressRelEmitter } from "./core-init";
import { newScanner } from "./scanner";
import { isERC20 } from "./scanner-erc20";

const debug = instrumentDebug('erc20Events')

export async function scanForERC20Events() {
  debug('Starting ERC20 Event Scanner')
  const txScanner = newScanner('erc20', ethRelsDatabase, addrRelsDB)

  // Handle realtime updates
  addressRelEmitter.on('AddressRelCreated', (event) => {
    const rel = event.rel
    if (isRx(rel) || isTx(rel)) {
      txScanner.notifyUpdate(toCursor(event.addr.id, rel), rel)
    }
  })

  // Ensure all historical state is crawled
  const txScan = txScanner.scan()
  for await (let [cursor, addrOrRel] of txScan) {
    if (isRx(addrOrRel) || isTx(addrOrRel)) {
      const txId = isERC20Transaction(addrOrRel)

    }

    /*const erc20Lookup = await fetchErc20Details(addrId)
    if (erc20Lookup) {
      //debug('Token found: ' + JSON.stringify(erc20Lookup, null, 2));
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
    }*/
  }
}

export const isERC20Transaction = async (txRx: Rx | Tx): Promise<Transaction['id'] | null> => {
  const [addr1, addr2] = getSourceDestFromRel(txRx.id)
  if (isAddressId(addr1) && await isERC20(addr1)) {
    return addr2 as Transaction['id']
  }
  if (isAddressId(addr2) && await isERC20(addr2)) {
    return addr1 as Transaction['id']
  }
  return null
}
