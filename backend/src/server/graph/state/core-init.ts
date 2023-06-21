import { TypedEmitter } from 'tiny-typed-emitter'
import { provider } from '../../eth'
import { addrDB, addrRelsDB, chainStateDb } from '../../lmdb'
import { isShuttingDown } from '../../server-utils'
import { fetchCustomBlocksBatch } from '../fetch-core-custom'
import {
  GraphCursor, parseCursor, toCursor
} from '../../../../../frontend/src/features/graph/global/fetch-contract'
import {
  Address,
  AddressRelations, EChainState,
  FullAddress, FullBlock, FullTransaction, getSourceDestFromRel, isContractCreated, isMiner,
  isRx,
  isTx
} from '../../../../../frontend/src/features/graph/global/types'
import {
  assertUnreachable,
  debug, fromRadix252, sleep,
  toRadix252
} from '../../../../../frontend/src/features/graph/global/utils'

type EChainStateChangeEvent = {
  state: EChainState
}

// Wait up to this long for new blocks
const MAX_BLOCK_POLL_RATE = 10 * 1000
const MAX_POLL_RETRIES = 20
// Iterate over all blocks and generate address relations from it
const FETCH_BATCH_COUNT = 4

// Export an event emitter that triggers whenever a factory event is seen
export type StateEvents = { EChainStateChanged: (rawEvent: EChainStateChangeEvent) => void }
export type BlockEvents = { BlockIndexed: (rawEvent: FullBlock) => void }
export type TransactionEvents = { TransactionCreated: (rawEvent: { transaction: FullTransaction, block: FullBlock }) => void }
export type AddressEvents = { AddressUpserted: (rawEvent: FullAddress) => void }
export type AddressRelEvents = { AddressRelCreated: (rawEvent: { rel: AddressRelations, addr: FullAddress }) => void }

export const stateEmitter = new TypedEmitter<StateEvents>()

//TODO?
const blockEmitter = new TypedEmitter<BlockEvents>()
const TransactionEmitter = new TypedEmitter<TransactionEvents>()

export const addressEmitter = new TypedEmitter<AddressEvents>()
export const addressRelEmitter = new TypedEmitter<AddressRelEvents>()

const timeSums = { balance: 0, block: 0, receipt: 0, write: 0 } as Record<
  'balance' | 'block' | 'receipt' | 'write',
  number
>
const timeCounts = { balance: 0, block: 0, receipt: 0, write: 0 } as Record<
  keyof typeof timeSums,
  number
>

// Reserved key for tracking current processed block
export const CHAIN_STATE_KEY = '_chain'

const MAX_HEAP_SIZE = 500258552 // Allow up to 500Mb of memory sized heap

let lastReportTime = new Date().getTime()

async function writeAddrRels(addrs: FullAddress[],
  rels: Record<GraphCursor, AddressRelations>,
): Promise<void> {
  // Force the calling thread to take precedence for a sec
  await sleep(1)
  const s = +new Date()

  const pendingAddrWrite = addrDB.batch(() => {
    for (const addr of addrs) {
      // If address already exists, merge and prefer existing except for ts and undefined fields
      const existing = addrDB.get(addr.id) as FullAddress | undefined
      const toPut = existing ?
        ({
          ...addr,
          c: toRadix252(Math.min(Number(fromRadix252(addr.ts)), Number(fromRadix252(existing.ts)))),
          eth: addr.eth,
          name: existing.name || addr.name,
          // Once a contract, always a contract
          t: (addr.t === 'c' || existing.t === 'c') ? 'c' : 'w',
          ts: addr.ts,
        } as FullAddress) : addr
      const pendingAddr = addrDB.put(addr.id, toPut)
      pendingAddr.then(() => addressEmitter.emit('AddressUpserted', toPut))
    }
  })

  const pendingRelsWrite = addrRelsDB.batch(() => {
    for (let key in rels) {
      const cursor = key as GraphCursor

      const pendingRel = addrRelsDB.put(cursor, rels[cursor])
      const addrId = parseCursor(cursor).id!
      pendingRel.then(() => {
        addressRelEmitter.emit('AddressRelCreated', {
          addr: addrs.find((a) => a.id === addrId)!,
          rel: rels[cursor]!
        })
      })
    }
  })
  await Promise.all([pendingAddrWrite, pendingRelsWrite])
  timeCounts.write += 1
  timeSums.write += +new Date() - s
}

// Update all Core LMDB-related state starting from block number
export async function mainIndexingLoop(
  earliestBlockNumber: number,
  updateChainState: boolean,
  chainState: typeof chainStateDb,
): Promise<void> {
  const gasPrice = (await provider.getGasPrice()).toString()
  let pendingWrites = Promise.resolve()
  let latestBlockNumber = await provider.getBlockNumber()
  let blockNumber = earliestBlockNumber - (earliestBlockNumber % FETCH_BATCH_COUNT)
  let i = 0

  let noUpdateCount = 0

  debug(`Starting core from ${earliestBlockNumber} / ${latestBlockNumber}`)
  while (!isShuttingDown()) {
    for (;
      !isShuttingDown() &&
      (blockNumber + FETCH_BATCH_COUNT) >= latestBlockNumber &&
      noUpdateCount < MAX_POLL_RETRIES; noUpdateCount++) {
      await sleep(MAX_BLOCK_POLL_RATE)
      latestBlockNumber = await provider.getBlockNumber()
    }
    if (noUpdateCount >= MAX_POLL_RETRIES) {
      debug('No new blocks in awhile, restarting!?')
      debug(`Stuck at block ${blockNumber}`)
      return
    }

    i += FETCH_BATCH_COUNT
    const maxBlock = Math.min(latestBlockNumber, blockNumber + FETCH_BATCH_COUNT - 1)
    const sb = +new Date()
    const pendingBatch = fetchCustomBlocksBatch(blockNumber, maxBlock)
    if (i % 128 === 0 && global.gc) {
      global.gc()
    }

    try {
      const batch = await pendingBatch
      if (!batch) {
        noUpdateCount++
      }
      else {
        noUpdateCount = 0
        timeCounts.balance += 1
        timeSums.balance += +new Date() - sb
        let writableRels: Record<GraphCursor, AddressRelations> = {}

        let minerCount = 0
        for (let addrRel of batch.addrRels) {
          let addrId: Address['id'] | null = null
          if (isRx(addrRel)) {
            addrId = getSourceDestFromRel(addrRel.id)[1] as Address['id']
          } else if (isTx(addrRel)) {
            addrId = getSourceDestFromRel(addrRel.id)[0] as Address['id']
          } else if (isContractCreated(addrRel)) {
            addrId = getSourceDestFromRel(addrRel.id)[1] as Address['id']
            // Enrich the rel if it's a miner
          } else if (isMiner(addrRel)) {
            addrId = getSourceDestFromRel(addrRel.id)[0] as Address['id']
            minerCount++
          } else {
            assertUnreachable(addrRel)
          }
          writableRels[toCursor(addrId!, addrRel)] = addrRel
        }


        // Sanity checks
        /*const addrCount = batch.addrs.length
        const blockCount = maxBlock - blockNumber + 1
        if (addrCount < 2) {
          debug(`Found ${addrCount} addresses for ${blockCount} blocks!`)
          await sleep(1000000)
        }
        if (minerCount != blockCount) {
          debug(`Found ${minerCount} miners for ${blockCount} blocks!`)
          await sleep(1000000)
        }*/

        await pendingWrites
        pendingWrites = writeAddrRels(batch.addrs, writableRels)
        pendingWrites.then(async () => {
          if (updateChainState) {
            const newState: EChainState = {
              bn: maxBlock - 1,
              ts: toRadix252(+new Date()),
              gas: gasPrice,
            }
            await chainState.put(CHAIN_STATE_KEY, newState)
            stateEmitter.emit('EChainStateChanged', {
              state: newState,
            })
          }
        })
      }
    }
    // If anything goes wrong, assume eth node is bogged down and quit the main
    // loop momentarily, causing a restart shortly after
    catch (e) {
      debug(`Something went wrong, bailing! ${JSON.stringify(e, null, 2)} ${(e as Error).message}`)
      debug(JSON.stringify((e as Error).stack))
      break
    }

    blockNumber = maxBlock + 1
    // Memory health check and/or reporting
    if (blockNumber % 2000 === 0) {
      const memory = process.memoryUsage()
      const memPercent = Math.round(100 * memory.heapUsed / MAX_HEAP_SIZE)
      // End core loop if memory leaks are getting crazy, turn it off and on again!
      if (memPercent > 80) {
        debug(`Heap: ${memory.heapUsed} (${memPercent}%)!`)
        break
      }

      // Status Logging
      if (blockNumber % 10000 === 0) {
        const now = new Date().getTime()
        debug(`Heap: ${memory.heapUsed} (${memPercent}%)`)
        debug(
          '\nProcessed LMDB data up to block ' +
          blockNumber +
          ' ' +
          Math.round((100 * blockNumber) / latestBlockNumber) +
          `% done (Speed: ${(now - lastReportTime) / 1000}s / 1k)`
        )
        debug(
          `rpc fetch vs write (ms): ${calcAndReset('balance')} vs ${calcAndReset('write')}`
        )
        lastReportTime = new Date().getTime()
      }
    }
  }

  debug(`Completed, processed ${blockNumber - earliestBlockNumber} blocks for LMDB`)
}

function calcAndReset(k: keyof typeof timeCounts): string {
  const time = (timeSums[k] / timeCounts[k]).toFixed(2)
  timeSums[k] = 0
  timeCounts[k] = 0
  return time
}
