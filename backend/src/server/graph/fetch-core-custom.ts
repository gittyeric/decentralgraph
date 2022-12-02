import { isEmpty } from 'lodash'
import { provider } from '../eth'
import {
  AddressRelations, ADDRESS_TYPE, BLOCK_TYPE, ContractCreated, CONTRACT_CREATED, FullAddress, Miner,
  MINER, newHexValuedId, newNumberValuedId, nodeId, relationId, Rx, RX, TRANSACTION_TYPE, Tx, TX
} from '../../../../frontend/src/features/graph/global/types'
import {
  assertUnreachable, hexToNumber,
  hexToRadix252,
  instrumentDebug,
  sleep
} from '../../../../frontend/src/features/graph/global/utils'

type CustomAddress = {
  address: string //'0x...'
  balance: string // '0x...'
}

type CustomTReceipt = {
  blockHash: string //'0x83952d392f9b0059eea94b10d1a095eefb1943ea91595a16c6698757127d4e1c'
  blockNumber: string //'0x16e360'
  contractAddress: string | null
  cumulativeGasUsed: string //'0x5208'
  effectiveGasPrice: string //'0xba43b7400'
  from: string //'0x1699333a4e46093e15a94b4a213b88eb8a963834'
  gasUsed: string //'0x5208'
  status: string //'0x1'
  to: string //'0x9d1e424358fa3376e995976e92437e0fb449e159'
  transactionHash: string //'0xbe03790872e51ef0ffe1b5d741bdaa09b4e158a579f721da0725ace53b55b87f'
  transactionIndex: string //'0x0'
  type: string //'0x0'
}

type CustomTransaction = {
  from: string //'0x1699333a4e46093e15a94b4a213b88eb8a963834'
  hash: string //'0xbe03790872e51ef0ffe1b5d741bdaa09b4e158a579f721da0725ace53b55b87f'
  to: string //'0x9d1e424358fa3376e995976e92437e0fb449e159'
  t: FullAddress['t'],
  value: string //'0x42d24f8401fb3800'
}

type CustomBlockResponse = {
  blocks: CustomBlockBatch[]
  balances: Record<string, string>
}

type CustomBlockBatch = {
  fullblock: {
    miner: string //'0x2a65aca4d5fc5b5c859090a6c34d1252135398226'
    number: string //'0x16e360'
    timestamp: string // hex
    transactions: CustomTransaction[]
  }
}

const debug = instrumentDebug('')

export type CustomBlockObjs = {
  addrs: FullAddress[]
  addrRels: AddressRelations[]
}
export async function fetchCustomBlocksBatch(
  minBlockNumber: number,
  maxBlockNumber: number,
): Promise<CustomBlockObjs | null> {
  const res = {
    addrs: [],
    addrRels: [],
  } as CustomBlockObjs

  const customBlocks = (await provider.send('erigon_getBlockNode', [
    minBlockNumber,
    maxBlockNumber,
  ])) as CustomBlockResponse

  const balances = customBlocks.balances
  // Weird edge case, just return null and retry
  if (isEmpty(balances)) {
    debug('called too early?')
    debug(JSON.stringify(customBlocks))
    return null
  }
  for (const cb of customBlocks.blocks) {
    const rawBlock = cb.fullblock
    // Process the block
    const bn = hexToNumber(rawBlock.number)
    const now = hexToRadix252(rawBlock.timestamp)
    const bid = newNumberValuedId(bn, BLOCK_TYPE)

    const miner: FullAddress = {
      id: newHexValuedId(rawBlock.miner, ADDRESS_TYPE),
      c: now,
      ts: now,
      t: 'w',
      eth: balances[rawBlock.miner.toLowerCase()],
    }
    const mined: Miner = {
      id: relationId(MINER, miner.id, bid),
      ts: now,
    }
    res.addrs.push(miner)
    res.addrRels.push(mined)

    // Process transactions then addresses
    for (let i = 0; i < rawBlock.transactions.length; i++) {
      const t = rawBlock.transactions[i]

      if (!t.from || !t.hash) {
        throw new Error('Wtf ' + JSON.stringify(t))
        process.exit()
      }

      const tid = newHexValuedId(t.hash!, TRANSACTION_TYPE)
      const fromAddrId = nodeId(ADDRESS_TYPE, hexToRadix252(t.from))
      if (!balances[t.from.toLowerCase()]) {
        Object.keys(balances).forEach((k) => {
          if (k.toString() === t.from.toString()) {
            debug('wtffffffff')
          } else {
            debug(k)
            debug(t.from)
          }
        })
        debug(JSON.stringify(balances[t.from.toLowerCase()], null, 2));
        debug(JSON.stringify(t, null, 2));
        debug(JSON.stringify('could not find sender? ' + t.from, null, 2));
      }
      const fullFrom: FullAddress = {
        id: fromAddrId,
        c: now,
        ts: now,
        t: 'w',
        eth: hexToRadix252(balances[t.from.toLowerCase()]),
      }
      res.addrs.push(fullFrom)

      const tx: Tx = {
        id: relationId(TX, fromAddrId, tid),
        ts: now,
        val: hexToRadix252(t.value),
      }
      res.addrRels.push(tx)
      // If a "to" field set, tx was sent to an address
      if (t.t === 'w') {
        const toAddrId = nodeId(ADDRESS_TYPE, hexToRadix252(t.to))
        const fullTo: FullAddress = {
          id: toAddrId,
          c: now,
          ts: now,
          t: 'w',
          eth: hexToRadix252(balances[t.to.toLowerCase()]),
        }
        res.addrs.push(fullTo)
        const rx: Rx = {
          id: relationId(RX, tid, toAddrId),
          ts: now,
          val: hexToRadix252(t.value.toString()),
        }
        res.addrRels.push(rx)
      }
      // Otherwise this was a contract creation, load the receipt to find the contract recipient
      else if (t.t === 'c') {
        const toAddrId = nodeId(ADDRESS_TYPE, hexToRadix252(t.to))
        const contract: FullAddress = {
          id: toAddrId,
          c: now,
          ts: now,
          t: 'c',
          eth: hexToRadix252(balances[t.to.toLowerCase()]),
        }
        res.addrs.push(contract)
        const contractCreated: ContractCreated = {
          id: relationId(CONTRACT_CREATED, tid, toAddrId),
          ts: now,
          val: hexToRadix252(t.value),
        }
        res.addrRels.push(contractCreated)
      } else {
        assertUnreachable(t.t)
      }
    }
  }

  return res
}
