import type { Block as EthBlock, BlockWithTransactions, TransactionReceipt, TransactionResponse as EthTransaction } from '@ethersproject/abstract-provider'
import { coreLogger } from '../../util'
import { provider } from '../eth'
import { addrDB, addrRelsDB, chainStateDb } from '../lmdb'
import {
  Err, FETCH_ERRORS, GraphCursor,
  GraphFetcher, isErr, isGraphCursor, NodeErr, parseCursor, startCursor
} from '../../../../frontend/src/features/graph/global/fetch-contract'
import { RELATION_PAGE_SIZE } from '../../../../frontend/src/features/graph/global/tuning'
import {
  Address,
  AddressRelations,
  ADDRESS_TYPE, Block, BLOCK_TYPE, ChildTransaction, CHILD_TRANSACTION, ContractCreated, CONTRACT_CREATED, EChainState,
  EnsName, FullBlock,
  FullTransaction, getSourceDestFromRel, initChainState, isAddressId, isTransaction, isTransactionId, Miner,
  MINER, newHexValuedId, newNumberValuedId, nodeId, NodeToRelations, ParentBlock, PARENT_BLOCK, parseBlockNumber,
  parseHexId, relationId, Rx, RX, Transaction,
  TRANSACTION_TYPE, Tx, TX
} from '../../../../frontend/src/features/graph/global/types'
import {
  decimalToRadix252, hexToRadix252, instrumentDebug, toRadix252
} from '../../../../frontend/src/features/graph/global/utils'
import { CHAIN_STATE_KEY } from './state/core-init'

const debug = instrumentDebug('fetch-core', [coreLogger.info, console.log])

/*export async function fetchFreshAddress(address: FullAddress): Promise<FullAddress | Err> {
  try {
    const hexId = parseHexId(address.id)
    const balance = provider.getBalance('0x' + hexId)
    const ensName = fetchEnsName(hexId)

    const all = await Promise.all([balance, ensName])
    return {
      ...address,
      eth: hexToRadix252(all[0].toHexString()),
      name: all[1] || address.name, // Keep at least the old ENS name if it ever existed
      ts: toRadix252(new Date().getTime()),
    }
  } catch (e) {
    return {
      c: FETCH_ERRORS.NODE_NOT_EXISTS,
    }
  }
}*/

export async function getChainState(): Promise<EChainState> {
  return (chainStateDb.get(CHAIN_STATE_KEY) as EChainState) || initChainState
}

export async function fetchTransactionRels(
  transaction: EthTransaction,
  parentBlock?: EthBlock | BlockWithTransactions,
): Promise<[FullTransaction, NodeToRelations[typeof TRANSACTION_TYPE][]]> {
  const transactionId = newHexValuedId(transaction.hash!, TRANSACTION_TYPE)
  const pendingReceipt = provider.getTransactionReceipt(transaction.hash!)
  const block = parentBlock || await provider.getBlock(transaction.blockNumber!)
  const receipt = await pendingReceipt
  const blockId = newNumberValuedId(BigInt(block.number), BLOCK_TYPE)
  const ts252 = decimalToRadix252(`${block.timestamp}`)
  const eth252 = hexToRadix252(transaction.value.toHexString())
  const fromAddrId = newHexValuedId(transaction.from!, ADDRESS_TYPE)
  const childRel: ChildTransaction = {
    id: relationId(CHILD_TRANSACTION, blockId, transactionId),
    ts: ts252,
  }
  const tx: Tx = {
    id: relationId(TX, fromAddrId, transactionId),
    ts: ts252,
    val: eth252
  }
  if (transaction.to) {
    const toAddrId = newHexValuedId(transaction.to, ADDRESS_TYPE)
    const rx: Rx = {
      id: relationId(RX, transactionId, toAddrId),
      ts: ts252,
      val: eth252,
    }

    let fullT: FullTransaction = rawToFullTransaction(transaction, receipt)
    return [fullT, [childRel, rx, tx]]
  }
  // Otherwise this was a contract creation, load the receipt to find the contract recipient
  else {
    const contractId = nodeId(ADDRESS_TYPE, hexToRadix252(receipt.contractAddress!))
    const rx: Rx = {
      id: relationId(RX, transactionId, contractId),
      ts: ts252,
      val: eth252,
    }
    const contractCreated: ContractCreated = {
      id: relationId(CONTRACT_CREATED, transactionId, contractId),
      ts: ts252,
      val: eth252,
    }
    let fullT: FullTransaction = rawToFullTransaction(transaction, receipt)
    // The 2nd-degree rels are too much for now!
    return [fullT, [childRel, rx, tx, contractCreated]]
  }
}

export const rawToFullTransaction = function (rawTransaction: EthTransaction, receipt: TransactionReceipt): FullTransaction {
  const transaction: FullTransaction = {
    id: newHexValuedId(rawTransaction.hash!, TRANSACTION_TYPE),
    blockNumber: toRadix252(rawTransaction.blockNumber!),
    eth: decimalToRadix252(rawTransaction.value.toString()),
    from: rawTransaction.from,
    gasUsed: decimalToRadix252(receipt.gasUsed.toString()),
    gasPrice: decimalToRadix252(receipt.effectiveGasPrice.toString()),
    gasLimit: decimalToRadix252(rawTransaction.gasLimit!.toString()),
    hash: hexToRadix252(rawTransaction.hash),
    //input: rawTransaction.input,
    nonce: toRadix252(rawTransaction.nonce),
    status: receipt.status as 0 | 1,
    to: rawTransaction.to ? rawTransaction.to.toString() : receipt!.contractAddress,
    //transactionIndex: rawTransaction.transactionIndex,
    //maxFeePerGas: rawTransaction.maxFeePerGas ? rawTransaction.maxFeePerGas!.toString() : undefined,
    //maxPriorityFeePerGas: rawTransaction.maxPriorityFeePerGas ? rawTransaction.maxPriorityFeePerGas!.toString() : undefined,
  }
  return transaction
}

export const rawToFullBlock = function (rawBlock: BlockWithTransactions): FullBlock {
  const block: FullBlock = {
    id: newNumberValuedId(BigInt(rawBlock.number), BLOCK_TYPE),
    difficulty: rawBlock.difficulty,
    extraData: rawBlock.extraData,
    gasLimit: rawBlock.gasLimit.toString(),
    gasUsed: rawBlock.gasUsed.toString(),
    hash: rawBlock.hash,
    miner: hexToRadix252(rawBlock.miner),
    nonce: rawBlock.nonce,
    number: toRadix252(rawBlock.number),
    parentHash: rawBlock.parentHash,
    ts: toRadix252(rawBlock.timestamp),
    //baseFeePerGas: rawBlock.baseFeePerGas ? rawBlock.baseFeePerGas.toString() : undefined,
  }
  return block
}

async function loadAddressIdFromEns(ensName: EnsName): Promise<Address['id'] | Err<FETCH_ERRORS.NODE_NOT_EXISTS>> {
  const hexId = await provider.resolveName(ensName)
  if (hexId) {
    return newHexValuedId(hexId, ADDRESS_TYPE)
  }
  return {
    c: FETCH_ERRORS.NODE_NOT_EXISTS,
    db: `Address ${ensName} not found`,
    usr: `Address ${ensName} not found`
  }
}

export const newCoreFetcher: () => GraphFetcher = () => {
  const fetcher: GraphFetcher = {
    fetchAddressTimeline: async function* (addressName: Address['id'] | EnsName) {
      const id = isAddressId(addressName) ? addressName : (await loadAddressIdFromEns(addressName))
      if (isErr(id)) {
        return id
      }

      debug(`fetchAddrTimeline (${id})`)

      let batch: GraphCursor[] = []
      let count = 0
      let curKey = startCursor(id)
      for (let i = 0; i < 1000; i++) {
        const kvIter = addrRelsDB.getKeys({
          start: curKey,
          offset: RELATION_PAGE_SIZE,
          limit: 1,
        })
        let keyStr: GraphCursor | null = null
        for (let k of kvIter) {
          keyStr = k
          break
        }
        // Out of keys, should be very rare
        if (!keyStr || keyStr === curKey) {
          break
        }

        curKey = keyStr
        const cursor = parseCursor(curKey)
        // If skipping past account, stop
        if (id !== cursor.id) {
          break
        }
        batch.push(keyStr)
        count++

        if (batch.length >= 10) {
          debug(`fat: yield batch of ${batch.length} ${id}`)
          yield batch
          batch = []
        }
      }
      if (batch.length > 0) {
        debug(`fat: flush batch of ${batch.length} ${id}`)
        yield batch
      }

      if (count === 0) {
        debug(`fat: return zero count for ${id}`)
        if (!addrDB.doesExist(id)) {
          return {
            c: FETCH_ERRORS.NODE_NOT_EXISTS,
            db: `Address ${id} not found`,
            usr: `Address ${parseHexId(id)} not found`
          }
        }
      }

      debug(`fat: return undefined for ${id}`)
      return undefined
    },
    fetchAddressRels: async function* (cur: GraphCursor | EnsName, includeAddress: boolean) {
      const pageCursor = isGraphCursor(cur) ? cur : null
      const resolvedAddr = pageCursor ? null : (await loadAddressIdFromEns(cur as EnsName))
      if (resolvedAddr && isErr(resolvedAddr)) {
        return resolvedAddr
      }
      const trueCursor = pageCursor || startCursor(resolvedAddr!)
      const parsedCursor = parseCursor(trueCursor)
      debug(`fetchAddrRels (${trueCursor}, ${includeAddress}) - cur: ${JSON.stringify(parsedCursor)}`)
      const addressId = parsedCursor.id
      const initCursor = startCursor(addressId)
      const isInitCursor = cur === initCursor
      const maxBatchSize = RELATION_PAGE_SIZE + (includeAddress && isInitCursor ? 1 : 0)
      const kvIter = addrRelsDB.getRange({
        start: trueCursor,
        limit: maxBatchSize + 1, // +1 to skip input cursor
      })

      let batch = [] as AddressRelations[]

      debug(`far: getting addr ${parseHexId(addressId)}`)
      const addr = addrDB.get(addressId)
      if (!addr) {
        debug(`far: No such address ${parseHexId(addressId)}`)
        return {
          c: FETCH_ERRORS.NODE_NOT_EXISTS,
          db: `Cursor ${cur} not found`,
          usr: `Address ${parseHexId(addressId)} not found`
        } as NodeErr
      }
      if (includeAddress) {
        debug(`far: yield Address ${parseHexId(addr.id)}`)
        yield [addr]
      }

      for (const { key, value } of kvIter) {
        const keyCursor = key as GraphCursor
        const val = value as AddressRelations
        debug('far: ' + keyCursor)


        const srcDest = getSourceDestFromRel(val.id)
        for (const n of srcDest) {
          if (isTransactionId(n)) {
            debug(`${n} id rel sent aka ${parseHexId(n)}`);
          }
        }


        // If skipping past account, stop
        if (addressId !== parseCursor(keyCursor).id) {
          break
        }
        if (batch.length >= maxBatchSize) {
          break
        }
        if (keyCursor !== cur) {
          batch.push(val)
        }
      }
      if (batch.length > 0) {
        debug(`far: batch of ${batch.length} (${cur})`)
        yield batch
      }
      debug(`far: done for ${parseHexId(addressId)}`)
      return undefined
    },
    /*fetchBlock: async function* (id: Block['id']) {
      debug(`fetchBlock (${parseBlockNumber(id)})`)
      const chainState = await getChainState()
      const blockNumber = parseBlockNumber(id)
      if (blockNumber < 0) {
        return {
          c: FETCH_ERRORS.NODE_NOT_EXISTS,
          db: 'Negative block number',
          usr: `Block numbers start from zero`,
        } as NodeErr
      }
      if (blockNumber > chainState.bn) {
        debug(`Error fetching block ${blockNumber} > ${chainState.bn}`)
        return {
          c: FETCH_ERRORS.NODE_NOT_EXISTS,
          db: 'Block number too big',
          usr: `Block ${blockNumber} exceeds latest block #${chainState.bn}`,
        } as NodeErr
      }
      try {
        const rawBlock = await provider.getBlockWithTransactions('0x' + blockNumber.toString(16))
        if (!rawBlock) {
          return {
            c: FETCH_ERRORS.NODE_NOT_EXISTS,
            db: `Block ${blockNumber} not found`,
            usr: `Block number ${blockNumber} does not exist`,
          } as NodeErr
        }
        const fullBlock = rawToFullBlock(rawBlock)
        const ts252 = decimalToRadix252(`${rawBlock.timestamp}`)

        // Yield incoming parent block link
        if (blockNumber > 0) {
          const parentId = newNumberValuedId(blockNumber - BigInt(1), BLOCK_TYPE)
          const parentLink: ParentBlock = {
            id: relationId(PARENT_BLOCK, parentId, fullBlock.id),
            ts: ts252,
          }
          debug(`Yield parent block ${blockNumber - BigInt(1)}`)
          yield [parentLink]
        }

        // Yield child block
        if (blockNumber < chainState.bn) {
          const childId = newNumberValuedId(blockNumber + BigInt(1), BLOCK_TYPE)
          const childLink: ParentBlock = {
            id: relationId(PARENT_BLOCK, fullBlock.id, childId),
            ts: ts252, //TODO: this ts isn't technically correct, but meh. Maybe load the child one day?
          }
          debug(`Yield child block ${blockNumber + BigInt(1)}`)
          yield [childLink]
        }

        // Yield miner relation
        const minerId = newHexValuedId(rawBlock.miner, ADDRESS_TYPE)
        const miner = addrDB.get(minerId)!
        const mine: Miner = {
          id: relationId(MINER, minerId, fullBlock.id),
          ts: ts252,
        }
        debug(`Yield miner`)
        yield [fullBlock, miner, mine]
        const trans = rawBlock.transactions.map((t) => ({id: newHexValuedId(t.hash!, TRANSACTION_TYPE)}) as Transaction)
        debug(`Yield ${trans.length} trans`)
        const un = new Set<string>()
        for (const t of trans) {
          if (un.has(t.id)) {
            debug(`DUPE! ${t.id}`)
            un.add(t.id)
          }
        }
        debug(`Yield ${(new Set(trans.map((t) => t.id))).size} UNIQUE trans`)
        if (trans.length === 0) {
          debug(JSON.stringify(trans, null, 2));
        }
        yield trans
      } catch (e) {
        debug(`getBlock Error! ${(e as Error).message}`)
        return {
          c: FETCH_ERRORS.NETWORK_ERROR,
          db: (e as Error).message,
          usr: `Couldn't find block ${blockNumber}, please try again shortly`
        } as NodeErr
      }

      debug(`fb ${blockNumber} done`)
    },*/
    fetchBlock: async function* (id: Block['id']) {
      debug(`fetchBlock (${parseBlockNumber(id)})`)
      const chainState = await getChainState()
      const blockNumber = parseBlockNumber(id)
      if (blockNumber < 0) {
        return {
          c: FETCH_ERRORS.NODE_NOT_EXISTS,
          db: 'Negative block number',
          usr: `Block numbers start from zero`,
        } as NodeErr
      }
      if (blockNumber > chainState.bn) {
        debug(`Error fetching block ${blockNumber} > ${chainState.bn}`)
        return {
          c: FETCH_ERRORS.NODE_NOT_EXISTS,
          db: 'Block number too big',
          usr: `Block ${blockNumber} exceeds latest block #${chainState.bn}`,
        } as NodeErr
      }
      try {
        const rawBlock = await provider.getBlockWithTransactions('0x' + blockNumber.toString(16))
        if (!rawBlock) {
          return {
            c: FETCH_ERRORS.NODE_NOT_EXISTS,
            db: `Block ${blockNumber} not found`,
            usr: `Block number ${blockNumber} does not exist`,
          } as NodeErr
        }
        const fullBlock = rawToFullBlock(rawBlock)
        const ts252 = decimalToRadix252(`${rawBlock.timestamp}`)

        // Yield incoming parent block link
        if (blockNumber > 0) {
          const parentId = newNumberValuedId(blockNumber - BigInt(1), BLOCK_TYPE)
          const parentLink: ParentBlock = {
            id: relationId(PARENT_BLOCK, parentId, fullBlock.id),
            ts: ts252,
          }
          debug(`Yield parent block ${blockNumber - BigInt(1)}`)
          yield [parentLink]
        }

        // Yield child block
        if (blockNumber < chainState.bn) {
          const childId = newNumberValuedId(blockNumber + BigInt(1), BLOCK_TYPE)
          const childLink: ParentBlock = {
            id: relationId(PARENT_BLOCK, fullBlock.id, childId),
            ts: ts252, //TODO: this ts isn't technically correct, but meh. Maybe load the child one day?
          }
          debug(`Yield child block ${blockNumber + BigInt(1)}`)
          yield [childLink]
        }

        // Yield miner relation
        const minerId = newHexValuedId(rawBlock.miner, ADDRESS_TYPE)
        const miner = addrDB.get(minerId)!
        const mine: Miner = {
          id: relationId(MINER, minerId, fullBlock.id),
          ts: ts252,
        }
        debug(`Yield miner`)
        yield [fullBlock, miner, mine]
        const trans = rawBlock.transactions.map((t) => ({id: newHexValuedId(t.hash!, TRANSACTION_TYPE)}) as Transaction)
        debug(`Yield ${trans.length} trans`)
        const un = new Set<string>()
        for (const t of trans) {
          if (un.has(t.id)) {
            debug(`DUPE! ${t.id}`)
            un.add(t.id)
          }
        }
        debug(`Yield ${(new Set(trans.map((t) => t.id))).size} UNIQUE trans`)
        if (trans.length === 0) {
          debug(JSON.stringify(trans, null, 2));
        }
        yield trans
      } catch (e) {
        debug(`getBlock Error! ${(e as Error).message}`)
        return {
          c: FETCH_ERRORS.NETWORK_ERROR,
          db: (e as Error).message,
          usr: `Couldn't find block ${blockNumber}, please try again shortly`
        } as NodeErr
      }

      debug(`fb ${blockNumber} done`)
    },
    /*fetchBlock: async function* (id: Block['id']) {
      debug(`fetchBlock (${parseBlockNumber(id)})`)
      const chainState = await getChainState()
      const blockNumber = parseBlockNumber(id)
      if (blockNumber < 0) {
        return {
          c: FETCH_ERRORS.NODE_NOT_EXISTS,
          db: 'Negative block number',
          usr: `Block numbers start from zero`,
        } as NodeErr
      }
      if (blockNumber > chainState.bn) {
        debug(`Error fetching block ${blockNumber} > ${chainState.bn}`)
        return {
          c: FETCH_ERRORS.NODE_NOT_EXISTS,
          db: 'Block number too big',
          usr: `Block ${blockNumber} exceeds latest block #${chainState.bn}`,
        } as NodeErr
      }
      try {
        const rawBlock = await provider.getBlockWithTransactions('0x' + blockNumber.toString(16))
        if (!rawBlock) {
          return {
            c: FETCH_ERRORS.NODE_NOT_EXISTS,
            db: `Block ${blockNumber} not found`,
            usr: `Block number ${blockNumber} does not exist`,
          } as NodeErr
        }
        const fullBlock = rawToFullBlock(rawBlock)
        const ts252 = decimalToRadix252(`${rawBlock.timestamp}`)

        // Yield incoming parent block link
        if (blockNumber > 0) {
          const parentId = newNumberValuedId(blockNumber - BigInt(1), BLOCK_TYPE)
          const parentLink: ParentBlock = {
            id: relationId(PARENT_BLOCK, parentId, fullBlock.id),
            ts: ts252,
          }
          debug(`Yield parent block ${blockNumber - BigInt(1)}`)
          yield [parentLink]
        }

        // Yield child block
        if (blockNumber < chainState.bn) {
          const childId = newNumberValuedId(blockNumber + BigInt(1), BLOCK_TYPE)
          const childLink: ParentBlock = {
            id: relationId(PARENT_BLOCK, fullBlock.id, childId),
            ts: ts252, //TODO: this ts isn't technically correct, but meh. Maybe load the child one day?
          }
          debug(`Yield child block ${blockNumber + BigInt(1)}`)
          yield [childLink]
        }

        const pendingTransNodesAndRels = await Promise.all(rawBlock.transactions.map(async (t) => {
          // TODO: maybe include T rels too?
          const [ft, ftRels] = await fetchTransactionRels(t, rawBlock)
          const tRel: ChildTransaction = {
            id: relationId(CHILD_TRANSACTION, fullBlock.id, ft.id),
            ts: ts252,
          }

          return [ft, tRel, ftRels]
        }))

        // Yield miner relation
        const minerId = newHexValuedId(rawBlock.miner, ADDRESS_TYPE)
        const miner = addrDB.get(minerId)!
        const mine: Miner = {
          id: relationId(MINER, minerId, fullBlock.id),
          ts: ts252,
        }
        debug(`Yield miner`)
        yield [fullBlock, miner, mine]
        const trans = (await pendingTransNodesAndRels).flat().flat()
        debug(`Yield ${trans.length} trans`)
        const un = new Set<string>()
        for (const t of trans) {
          if (un.has(t.id)) {
            debug(`DUPE! ${t.id}`)
            un.add(t.id)
          }
        }
        debug(`Yield ${(new Set(trans.map((t) => t.id))).size} UNIQUE trans`)
        if (trans.length === 0) {
          debug(JSON.stringify(trans, null, 2));
        }
        yield trans
      } catch (e) {
        debug(`getBlock Error! ${(e as Error).message}`)
        return {
          c: FETCH_ERRORS.NETWORK_ERROR,
          db: (e as Error).message,
          usr: `Couldn't find block ${blockNumber}, please try again shortly`
        } as NodeErr
      }

      debug(`fb ${blockNumber} done`)
    },*/
    fetchTransaction: async function* (id: Transaction['id']) {
      debug(`fetchTransaction(${id})`)
      const hash = parseHexId(id)
      try {
        const rawTransaction = await provider.getTransaction(hash)
        if (!rawTransaction) {
          return {
            c: FETCH_ERRORS.NODE_NOT_EXISTS,
            db: `Tx ${hash} not found`,
            usr: `Transaction with hash ${hash} does not exist`,
          } as NodeErr
        }

        const block = await provider.getBlock(rawTransaction.blockNumber!)
        const [fullT, tRels] = await fetchTransactionRels(rawTransaction, block)
        debug(`fetchTransaction yield full and ${tRels.length} rels`)
        yield [fullT, ...tRels]
      } catch (e) {

        debug(`fetchTransaction Error tx not found: ${hash}`)
        return {
          c: FETCH_ERRORS.NETWORK_ERROR,
          db: (e as Error).message,
          usr: `Couldn't find transaction ${hash}, please try again shortly`
        } as NodeErr
      }
    },
    requestServerPush: async function* () {
      //const queue = new BlockingQueue<StateObjs>()
      /*stateEmitter.addListener('EChainStateChanged', (event) => {
        queue.enqueue(event.state)
      })*/

      //yield await queue.dequeue()
      return getChainState()
    },
  }
  return fetcher
}
