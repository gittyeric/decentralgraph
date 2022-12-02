import { FullAddress } from './types'
import { wei252ToBigInt } from './utils'

export const WHALE_ETH_CUTOFF = 500

export function isWhale(node: FullAddress): boolean {
  const eth = wei252ToBigInt(node.eth)
  return eth > WHALE_ETH_CUTOFF
}

export function isContract(node: FullAddress): boolean {
  return node.t === 'c'
}
