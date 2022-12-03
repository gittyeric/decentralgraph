import { FullAddress } from './types'
import { wei252ToBigInt } from './utils'

// 500 ETH or more is a "whale"
export const WHALE_WEI_CUTOFF = BigInt("500000000000000000000")

export function isWhale(node: FullAddress): boolean {
  const eth = wei252ToBigInt(node.eth)
  return eth > WHALE_WEI_CUTOFF
}

export function isContract(node: FullAddress): boolean {
  return node.t === 'c'
}
