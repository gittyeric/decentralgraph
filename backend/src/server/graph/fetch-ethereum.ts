import { BigNumber, ethers } from 'ethers'
import erc20Abi from '../../abi/erc20.json'
import { provider } from '../eth'
import { Address, parseHexId, Rx, Transaction, Tx } from '../../../../frontend/src/features/graph/global/types'
import { hexToRadix252 } from '../../../../frontend/src/features/graph/global/utils'

export async function fetchEnsName(ethAddress: string, retries: number = 1): Promise<string | null> {
  try {
    console.log('fetch ens ' + ethAddress)
    return await provider.lookupAddress(ethAddress)
  } catch (e) {
    throw e;
    const err = e as Error
    if (err.message.includes('revert') && retries > 0) {
      return await fetchEnsName(ethAddress, retries - 1);
    }
    // TODO: add to error report?
    //debug(`ENS error for addr ${ethAddress}?` + err.message);
    return null
  }
}

export type Erc20Details = {
  n: string, // name
  sym: string, // Token symbol
  dec: number, // Decimals
  sup: string, // Total supply in radix 252
}

function expectType<T>(varName: string, val: any, expectedType: string, expectedClass?: any): T {
  const valType = typeof (val)
  if (valType !== expectedType) {
    throw new Error(`${varName} was expected to be ${expectedType} but was '${valType}' ${JSON.stringify(val)}`)
  }
  if (expectedClass) {
    if (!(val instanceof expectedClass)) {
      throw new Error(`${varName} was expected to be instance of ${expectedClass}`)
    }
  }
  return val as T
}

export const fetchContractBytecode = async (addressId: Address['id']): Promise<string> => {
  const hexId = parseHexId(addressId)
  const code = await provider.getCode(
    hexId
  )
  return code
}

export const fetchErc20Events = async (tx: Transaction['id']): Promise<void> => {

}

export const fetchErc20Details = async (addressId: Address['id']): Promise<Erc20Details | undefined> => {
  const hexId = parseHexId(addressId)
  try {
    const contract = new ethers.Contract(hexId, erc20Abi, provider)
    const symbol = expectType<string>('symbol', await contract.symbol(), 'string')
    const decimals = expectType<number>('decimals', await contract.decimals(), 'number')
    const name = expectType<string>('name', await contract.name(), 'string')
    const totalSupply = expectType<BigNumber>('totalSupply', await contract.totalSupply(), 'object', BigNumber)

    if (totalSupply.lte(0)) {
      throw new Error('Non-positive total supply? ' + totalSupply.toString())
    }

    return {
      n: name,
      sym: symbol,
      dec: decimals,
      sup: hexToRadix252(totalSupply.toHexString()),
    }
  } catch (e) {
    const msg = (e as Error).message
    if (!msg.includes('symbol') && !msg.includes('Non-positive total')) {
      //debug((e as Error).message)
    }
  }
}
