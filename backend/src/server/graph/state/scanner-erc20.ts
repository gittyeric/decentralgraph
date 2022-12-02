import { abiDatabase, addrDB, codeHashToContractsDB, erc20DB } from "../../lmdb";
import { fetchErc20Details } from "../fetch-ethereum";
import { Address, FullAddress, isAddressId } from "../../../../../frontend/src/features/graph/global/types";
import { instrumentDebug } from "../../../../../frontend/src/features/graph/global/utils";
import { newScanner } from "./scanner";
import { contractEmitter } from "./scanner-code";

const debug = instrumentDebug('erc20')

export async function scanForERC20() {
  debug('Starting ERC20 Scanner')
  const contractScanner = newScanner('erc20', abiDatabase, codeHashToContractsDB)

  // Handle realtime updates
  contractEmitter.on('ContractUpserted', (contract) => {
    const x: FullAddress = contract.address
    contractScanner.notifyUpdate(contract.code, [x.id])
  })

  // Ensure all historical state is crawled
  const contractScan = contractScanner.scan()
  for await (let [code, addrIds] of contractScan) {
    for (const addrId of addrIds) {
      if (!isAddressId(addrId)) {
        throw new Error('Invalid addr ID in codeHashToContractsDB? ' + addrId)
      }
      if (!isAddressId(addrId) || erc20DB.doesExist(addrId)) {
        continue
      }

      const erc20Lookup = await fetchErc20Details(addrId)
      if (erc20Lookup) {
        //debug('Token found: ' + JSON.stringify(erc20Lookup, null, 2));
        await erc20DB.put(addrId, erc20Lookup)

        // Refresh and set Addr name in transaction to avoid an overwrite
        addrDB.transactionSync(() => {
          const freshAddrObj = addrDB.get(addrId)!
          if (!freshAddrObj.name) {
            freshAddrObj.name = freshAddrObj.name ?? erc20Lookup.n
            addrDB.put(addrId, freshAddrObj)
          }
        })
      }
    }
  }
}

export async function isERC20(addrId: Address['id']): Promise<boolean> {
  return erc20DB.doesExist(addrId)
}
