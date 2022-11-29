import { FullAddress } from './types'
import { eth252ToRoughEth } from './utils'

export const WHALE_ETH_CUTOFF = 100000

export function isWhale(node: FullAddress): boolean {
  const eth = eth252ToRoughEth(node.eth)
  return false && eth > WHALE_ETH_CUTOFF
}

export function isContract(node: FullAddress): boolean {
  return node.t === 'c'
}
