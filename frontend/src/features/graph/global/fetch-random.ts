import * as Random from 'random-seed'
import {
  GraphCursor,
  GraphFetcher,
  parseCursor,
  toCursor
} from './fetch-contract'
import { RELATION_PAGE_SIZE } from './tuning'
import {
  Address, AddressRelations, ADDRESS_TYPE, Block, BlockRelations, BLOCK_TYPE, ChildTransaction,
  CHILD_TRANSACTION,
  ContractCreated,
  CONTRACT_CREATED, FullAddress,
  FullBlock,
  FullNodes,
  FullTransaction,
  GraphNodes, isAddress, isFullBlock,
  isFullTransaction, Miner,
  MINER, nodeId, NodeType, ParentBlock, PARENT_BLOCK, parseBlockNumber,
  relationId, Relations, Rx,
  RX, Transaction, TransactionRelations, TRANSACTION_TYPE, Tx,
  TX
} from './types'
import { assertUnreachable, fromRadix252, instrumentDebug, sleep, toRadix252 } from './utils'

const rand = Random.create('123')
const MAX_RANDOM_TIMEOUT = 1
const debug = instrumentDebug('fetch-random')

async function* generateRandomNodesOfType<FN extends FullNodes>(
  count: number,
  gen: () => FN
): AsyncGenerator<FN, undefined, unknown> {
  for (let i = 0; i < count; i++) {
    yield gen()
  }
  return undefined
}

const NODE_FREQUENCY_MAP = [
  [ADDRESS_TYPE as NodeType, 0.8 as number] as const,
  [BLOCK_TYPE as NodeType, 0.03 as number] as const,
  [TRANSACTION_TYPE as NodeType, 0.17 as number] as const,
]

function normalize(
  nfp: typeof NODE_FREQUENCY_MAP[number][]
): typeof NODE_FREQUENCY_MAP[number][] {
  let sum = 0
  nfp.forEach((n) => (sum += n[1]))
  const scalar = 1.0 / sum
  return nfp.map((n) => [n[0], n[1] * scalar])
}

export function generateRandomAddress(): FullAddress {
  return {
    id: `${ADDRESS_TYPE},${toRadix252(rand.intBetween(1, 999999999))}` as const,
    eth: toRadix252(rand.intBetween(0, 1000000000)),
    t: rand.random() < 0.1 ? 'c' : 'w',
    ts: toRadix252(new Date().getTime()),
    c: toRadix252(rand.intBetween(0, new Date().getTime())),
  }
}

export function generateRandomBlock(): FullBlock {
  const block: FullBlock = {
    id: `${BLOCK_TYPE},${toRadix252(rand.intBetween(1, 99999999))}` as const,
    difficulty: rand.floatBetween(1, 10),
    extraData: rand.intBetween(1, 9999999).toString(),
    gasLimit: rand.floatBetween(1, 20).toString(),
    gasUsed: rand.floatBetween(0, 10).toString(),
    hash: `0x${rand.intBetween(0, 9999999999)}`,
    miner: `${rand.intBetween(1, 99999999)}` as const,
    nonce: rand.intBetween(1, 9999999).toString(),
    number: toRadix252(rand.intBetween(200, 9999)),
    parentHash: `0x${rand.intBetween(0, 9999999999)}`,
    ts: toRadix252(rand.intBetween(0, +new Date())),
    //baseFeePerGas: rand.intBetween(1, 9999).toString(),
  }
  return block
}

export function generateRandomTransaction(): FullTransaction {
  const t: FullTransaction = {
    id: `${TRANSACTION_TYPE},${toRadix252(rand.intBetween(1, 99999999))}` as const,
    blockNumber: toRadix252(rand.intBetween(1, 999999)),
    eth: toRadix252(rand.intBetween(0, 1000000000)),
    from: `0x${rand.intBetween(0, 999999999)}`,
    gasPrice: `${rand.intBetween(0, 2000000)}`,
    gasLimit: `${rand.intBetween(0, 20)}`,
    hash: `0x${rand.intBetween(0, 9999999999)}`,
    nonce: toRadix252(rand.intBetween(0, 999)),
    to: `0x${rand.intBetween(1, 9999999)}`,
    status: rand.intBetween(0, 1) as 0 | 1,
    gasUsed: '1',
  }
  return t
}

export function generateRandomTx(sender: Address['id'], transaction: Transaction['id']): Tx {
  return {
    id: `${TX},${sender}-${transaction}` as Tx['id'],
    val: toRadix252(rand.intBetween(1, 10000000)),
    ts: generateRandomTs(),
  }
}

export function generateRandomRx(receiver: Address['id'], transaction: Transaction['id']): Rx {
  return {
    id: `${RX},${transaction}-${receiver}` as Rx['id'],
    val: toRadix252(rand.intBetween(1, 100000000)),
    ts: generateRandomTs(),
  }
}

export function generateRandomContractCreated(
  receiver: Address['id'],
  transaction: Transaction['id']
): ContractCreated {
  return {
    id: `${CONTRACT_CREATED},${transaction}-${receiver}` as ContractCreated['id'],
    val: toRadix252(rand.intBetween(1, 10000000)),
    ts: generateRandomTs(),
  }
}

export function generateRandomTs(): string {
  return toRadix252(rand.intBetween(0, new Date().getTime()))
}

export function generateRandomMine(miner: Address['id'], block: Block['id']): Miner {
  return {
    id: `${MINER},${miner}-${block}` as Miner['id'],
    ts: generateRandomTs(),
  }
}

export function generateRandomChildTransaction(
  transaction: FullTransaction['id'],
  block: FullBlock['id']
): ChildTransaction {
  return {
    id: `${CHILD_TRANSACTION},${block}-${transaction}` as ChildTransaction['id'],
    ts: generateRandomTs(),
  }
}

export async function* generateRandomAddressNeighbors(
  address: Address['id'],
  count: number
): AsyncGenerator<AddressRelations, undefined, AddressRelations> {
  const noAddresses = [[BLOCK_TYPE, 0.05], [TRANSACTION_TYPE, 0.95]] as typeof NODE_FREQUENCY_MAP
  const neighborGen = generateRandomNodes<FullTransaction | FullBlock>(
    count,
    [generateRandomBlock, generateRandomTransaction],
    noAddresses
  )

  // For each generated neighbor, create at least 1 relation between the nodes
  for await (const neighbor of neighborGen) {
    // yield neighbor;

    // Emit a random relation
    if (isFullTransaction(neighbor)) {
      //Flip coin to be Rx or Tx
      if (rand.random() < 0.5) {
        // Flip for Rx vs contract
        yield generateRandomRx(address, neighbor.id)
      } else {
        yield generateRandomTx(address, neighbor.id)
      }
    } else if (isFullBlock(neighbor)) {
      yield generateRandomMine(address, neighbor.id)
    }
  }

  return undefined
}

export async function* generateRandomTransactionNeighbors(
  trans: FullTransaction,
  count: number
): AsyncGenerator<TransactionRelations, undefined, TransactionRelations> {
  const noAddresses = normalize(NODE_FREQUENCY_MAP.filter((n) => n[0] !== TRANSACTION_TYPE))
  const neighborGen = generateRandomNodes<FullAddress>(
    count,
    [generateRandomAddress],
    noAddresses
  )

  // For each generated neighbor, create at least 1 relation between the nodes
  for await (const neighbor of neighborGen) {
    //yield neighbor;

    // Emit a random relation
    if (isAddress(neighbor)) {
      //Flip coin to be Rx or Tx
      if (rand.random() < 0.5) {
        // Flip for Rx vs contract
        if (rand.random() < 0.1) {
          yield generateRandomContractCreated(neighbor.id, trans.id)
        } else {
          yield generateRandomRx(neighbor.id, trans.id)
        }
      } else {
        yield generateRandomTx(neighbor.id, trans.id)
      }
    }
  }

  return undefined
}

export async function* generateRandomBlockNeighbors(
  block: FullBlock,
  transactionCount: number
): AsyncGenerator<Exclude<BlockRelations, ParentBlock>, undefined, undefined> {
  // Generate 1 miner
  const miner = (await generateRandomNodesOfType(1, generateRandomAddress).next())
    .value as FullAddress
  //yield miner;
  // Generate miner relation
  yield generateRandomMine(miner.id, block.id)

  // For each generated neighbor, create at least 1 relation between the nodes
  const transactionGen = generateRandomNodes<FullTransaction>(
    transactionCount,
    [generateRandomTransaction],
    [[TRANSACTION_TYPE, 1]]
  )
  for await (const childTransaction of transactionGen) {
    //yield childTransaction;

    // Emit a random relation
    if (isFullTransaction(childTransaction)) {
      yield generateRandomChildTransaction(childTransaction.id, block.id)
    } else {
      throw new Error('wtfffff')
    }
  }

  return undefined
}

async function* generateRandomNodes<N extends GraphNodes>(
  count: number,
  gens: (() => N)[],
  nodeFreqMap: typeof NODE_FREQUENCY_MAP[number][]
): AsyncGenerator<GraphNodes, undefined, unknown> {
  for (let i = 0; i < count; i++) {
    // Flip a coin and return random type
    const coin = rand.random()
    let nodeType: NodeType = nodeFreqMap[0][0]
    let coinSum = 0
    for (let freq of nodeFreqMap) {
      nodeType = freq[0]
      coinSum += freq[1]
      if (coinSum < coin) {
        break
      }
    }
    switch (nodeType) {
      case ADDRESS_TYPE: {
        yield generateRandomAddress()
        break
      }
      case BLOCK_TYPE: {
        yield generateRandomBlock()
        break
      }
      case TRANSACTION_TYPE: {
        yield generateRandomTransaction()
        break
      }
      default: {
        assertUnreachable(nodeType)
      }
    }
  }
  return undefined
}

const knownAddressToRelCount: Record<Address['id'], number> = {}
const ensureAddressRelCount = (id: Address['id']) => {
  if (!knownAddressToRelCount[id]) {
    knownAddressToRelCount[id] = rand.intBetween(1, 2) * RELATION_PAGE_SIZE
  }
}

export const newRandomGraphFetcher: () => GraphFetcher = () => {

  const fetcher: GraphFetcher = {
    fetchAddressTimeline: async function* (id: Address['id']) {
      ensureAddressRelCount(id)
      const cursorCount = Math.ceil(knownAddressToRelCount[id] / RELATION_PAGE_SIZE)
      const batch: GraphCursor[] = []
      for (let i = 0; i < cursorCount; i++) {
        const randomRel = (await generateRandomAddressNeighbors(id, 1).next()).value as Relations
        randomRel.ts = toRadix252(i * 1000000)
        batch.push(toCursor(id, randomRel))
      }
      yield batch
      return undefined
    },
    fetchAddressRels: async function* (cursor: GraphCursor, includeAddress: boolean) {
      debug(`Fetch random ${cursor}`)
      // First make up the address
      const addr = (await generateRandomNodesOfType(1, generateRandomAddress).next())
        .value as FullAddress
      const { id, timeMs: time } = parseCursor(cursor)
      addr.id = id
      ensureAddressRelCount(addr.id)

      if (includeAddress) {
        yield [addr]
      }

      const neighborCount = RELATION_PAGE_SIZE
      const neighborObjs = generateRandomAddressNeighbors(addr.id, neighborCount)
      let i = 0
      for (; i < RELATION_PAGE_SIZE; i++) {
        const next = await neighborObjs.next()
        if (next.done) {
          break
        }
        const rel = next.value
        rel.ts = toRadix252(time + i * 1000 + 1)
        yield [next.value]
      }
      return undefined
    },

    fetchBlock: async function* (blockId: Block['id']) {
      debug(`Fetch random ${blockId}`)
      // First make up the block
      const block = (await generateRandomNodesOfType(1, generateRandomBlock).next())
        .value as FullBlock
      block.id = blockId
      yield [block]

      // Make up the previous block
      const blockNumber = parseBlockNumber(block.id)
      if (blockNumber > 0) {
        const parentId = nodeId(BLOCK_TYPE, toRadix252(Number(fromRadix252(block.number)) - 1))
        const parentBlockRelation = {
          id: relationId(PARENT_BLOCK, parentId, block.id),
        } as ParentBlock
        yield [parentBlockRelation]
      }

      // Make up the next block
      const childId = nodeId(BLOCK_TYPE, toRadix252(Number(fromRadix252(block.number)) + 1))
      const childBlockRelation = {
        id: relationId(PARENT_BLOCK, block.id, childId),
      } as ParentBlock
      yield [childBlockRelation]

      // Make up a miner and transactions
      const neighborObjs = generateRandomBlockNeighbors(block, rand.intBetween(6, 50))
      while (true) {
        const next = await neighborObjs.next()
        if (next.done) {
          break
        }
        yield [next.value]
      }
      return undefined
    },

    fetchTransaction: async function* (transactionId: Transaction['id']) {
      debug(`Fetch random ${transactionId}`)
      // First make up the T
      const transaction = (
        await generateRandomNodesOfType(1, generateRandomTransaction).next()
      ).value as FullTransaction
      transaction.id = transactionId
      yield [transaction]

      const neighborObjs = generateRandomTransactionNeighbors(
        transaction,
        rand.intBetween(2, 20)
      )
      while (true) {
        const next = await neighborObjs.next()
        if (next.done) {
          break
        }
        yield [next.value]
      }
      return undefined
    },

    requestServerPush: async function* () {
      let blockNumber = rand.intBetween(100, 10000)
      while (true) {
        await sleep(3000)
        return {
          bn: blockNumber++,
          gas: toRadix252(rand.intBetween(1, 1000000)),
          ts: toRadix252(new Date().getTime()),
        }
        //await sleep(1000 * 30)
      }
    },
  }
  return fetcher
}
