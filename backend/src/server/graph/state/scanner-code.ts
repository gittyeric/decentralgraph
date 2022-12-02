import { TypedEmitter } from "tiny-typed-emitter";
import { config } from "../../../../config/config";
import { execAsync, shrunkenSha1 } from "../../../util";
import { addrDatabase, addrDB, codeHashToContractsDB, contractToCodeHashDB } from "../../lmdb";
import { fetchContractBytecode } from "../fetch-ethereum";
import { Address, FullAddress, isFullAddress, parseHexId } from "../../../../../frontend/src/features/graph/global/types";
import { instrumentDebug, sleep } from "../../../../../frontend/src/features/graph/global/utils";
import { addressEmitter } from "./core-init";
import { newScanner } from "./scanner";

const debug = instrumentDebug('abi')

type ContractUpserted = {
  address: FullAddress
  code: string
}
export type ContractEvents = {
  ContractUpserted: (rawEvent: ContractUpserted) => void
}

export const contractEmitter = new TypedEmitter<ContractEvents>()

/**
 * This scans all contracts to store and index their code as a shrunken hash.
 * This allows for contract -> code hash lookups as well as reverse code hash -> address
 * lookup
 */
export async function scanForByteCode() {
  debug('Starting Contract Code Scanner, codes count')
  debug(`So far: ${codeHashToContractsDB.getKeysCount()} unique contracts and ${contractToCodeHashDB.getKeysCount()} instances`)
  const codeScanner = newScanner('code', addrDatabase, addrDB)

  // Handle realtime updates
  addressEmitter.on('AddressUpserted', (address) => {
    if (address.t === 'c') {
      codeScanner.notifyUpdate(address.id, address)
    }
  })

  // Ensure all historical state is crawled
  const codeScan = codeScanner.scan()

  for await (let [addrKey, addrObj] of codeScan) {
    if (addrObj.t !== 'c') {
      continue
    }
    if (contractToCodeHashDB.doesExist(addrObj.id)) {
      continue
    }

    const bytecode = await fetchContractBytecode(addrObj.id)
    const hashedCode = shrunkenSha1(bytecode)
    await contractToCodeHashDB.put(addrObj.id, hashedCode)

    const existingHashEntry = codeHashToContractsDB.get(hashedCode)
    const matchingContracts: Address['id'][] = existingHashEntry ?? []
    await codeHashToContractsDB.put(hashedCode,
      Array.from(new Set(matchingContracts.concat(addrObj.id))))

    contractEmitter.emit('ContractUpserted', {
      address: addrObj,
      code: hashedCode
    })
  }
}

export const getAllContractClones = async (contractAddress: Address['id']): Promise<Address['id'][]> => {
  const contractCode = contractToCodeHashDB.get(contractAddress)
  if (!contractCode) {
    debug(`Warning, no clones found for contract ${contractAddress}?`)
    return [contractAddress]
  }
  const clones = codeHashToContractsDB.get(contractCode)
  if (!clones) {
    debug(`Warning, no clone code found for contract ${contractAddress}?`)
    return [contractAddress]
  }
  return clones
}
