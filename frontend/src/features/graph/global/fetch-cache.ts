import cloneDeep from 'lodash.clonedeep'
import {
  FETCH_ERRORS,
  GraphCursor,
  GraphFetcher,
  isErr,
  MAX_ADDRESS_AGE_TILL_STALE,
  parseCursor,
  toCursor
} from './fetch-contract'
import { RELATION_PAGE_SIZE } from './tuning'
import {
  Address,
  AddressRelations,
  Block,
  BlockRelations,
  FullAddress,
  FullBlock,
  FullTransaction,
  GraphNodes,
  isAddress,
  isFullAddress,
  isFullBlock,
  isFullTransaction,
  isGraphNode,
  isTransaction,
  PaginatedNode,
  Transaction,
  TransactionRelations
} from './types'
import { fromRadix252, instrumentDebug, toRadix252 } from './utils'

export type CachedAddressRelation = AddressRelations[]

export type CachedAddress = FullAddress

export type CachedTransaction = {
  o: FullTransaction
  r: TransactionRelations[]
}

export type CachedBlock = {
  o: FullBlock
  r: (BlockRelations | TransactionRelations)[]
}

export type CachedNode = CachedBlock | CachedTransaction | CachedAddress

export function isCachedAddress(cNode: CachedNode): cNode is CachedAddress {
  return isFullAddress(cNode)
}

export type CacheValue = CachedNode | CachedAddressRelation

export enum MissType {
  //NOT_EXIST = 0,
  NETWORK_ERROR = 1,
  CACHE_MISS = 2,
}

export type CacheMiss = {
  f: MissType
}

export type CacheHit<V extends CacheValue> = {
  s: V
}
export type CacheResult<V extends CacheValue> = CacheMiss | CacheHit<V>

export function isCacheSuccess<V extends CacheValue>(res: CacheResult<V>): res is CacheHit<V> {
  return typeof ((res as CacheHit<V>).s) !== 'undefined'
}

export type CacheKeyExists = 'm' | 'n' | 'y'
export type CacheKey = GraphNodes['id'] | GraphCursor
export type Cache = {
  exists: (key: CacheKey) => Promise<CacheKeyExists>
  setNotExists: (key: CacheKey) => Promise<void>
  // Returns null for def doesn't exist and undefined if not known
  get: <V extends CacheValue>(key: CacheKey) => Promise<CacheResult<V>>
  set: (key: CacheKey, val: CacheValue) => Promise<void>
  getTimeline: (key: PaginatedNode['id']) => Promise<GraphCursor[] | null>
  setTimeline: (key: PaginatedNode['id'], timeline: GraphCursor[]) => Promise<void>
}

const debug = instrumentDebug('fetch-cache')

function getNextCursor(lastCursor: GraphCursor, rels: AddressRelations[]): GraphCursor {
  if (rels.length === RELATION_PAGE_SIZE) {
    const parsed = parseCursor(lastCursor)
    const lastRel = rels[rels.length - 1]
    return toCursor(parsed.id, lastRel)
  }
  return lastCursor
}

export function cachedGraphFetcher(
  cache: Cache,
  fetcher: GraphFetcher,
  cacheIsFree: boolean,
  cacheSrcName: string,
  cacheOnly: boolean = false
): GraphFetcher {
  async function loadNextPageLocal(
    cursor: GraphCursor
  ): Promise<[AddressRelations[], GraphCursor]> {
    const hit = await cache.get<CachedAddressRelation>(cursor)
    if (isCacheSuccess(hit)) {
      const rels = hit.s
      return [rels, getNextCursor(cursor, rels)]
    } else {
      return [[], cursor]
    }
  }

  type RelsGenerator = AsyncGenerator<AddressRelations[], undefined, AddressRelations[]>
  async function* loadAllCachedAddressRelations(
    cursor: GraphCursor,
    oneBatchOnly: boolean
  ): RelsGenerator {
    let thisCursor = cursor
    while (true) {
      const [page, nextCursor] = await loadNextPageLocal(thisCursor)
      if (!page) {
        return undefined
      } else {
        yield page
      }

      if (oneBatchOnly || thisCursor === nextCursor) {
        return undefined
      }
      thisCursor = nextCursor
    }
  }

  const cacheWrite = async (key: CacheKey, val: CacheValue) => {
    // If cache is free, can afford to await the write to
    // increase odds of cache hit next time
    const cacheWriting = cache.set(key, val)
    if (cacheIsFree) {
      await cacheWriting
    }
    const copy = cloneDeep(val)
    //@ts-ignore
    delete copy['o']
    debug(`Wrote to cache ${key} ${JSON.stringify(copy)}`)
  }

  let addrHits = 0
  let addrMisses = 1
  let addrExistHits = 0
  let addrExistMisses = 1

  let nodeHits = 0
  let nodeMisses = 1
  let nodeExistHits = 0
  let nodeExistMisses = 1

  return {
    fetchAddressTimeline: async function* (id: Address['id']) {
      const cached = await cache.getTimeline(id)
      if (cached) {
        yield cached
      } else {
        const fullTimeline: GraphCursor[] = []
        const fetching = fetcher.fetchAddressTimeline(id)
        while (true) {
          const batch = await fetching.next()
          if (batch.done) {
            if (!isErr(batch.value) && fullTimeline.length > 0) {
              cache.setTimeline(id, fullTimeline)
            }
            return batch.value
          }
          yield batch.value
          fullTimeline.push(...batch.value)
        }
      }
    },
    fetchAddressRels: async function* (cursor: GraphCursor, includeAddress: boolean) {
      // Step 1: Try loading address from cache!
      const addressId = parseCursor(cursor).id
      let addressHit: CachedAddress | null = null
      const existResult = await cache.exists(addressId)
      if (existResult === 'n') {
        addrExistHits++
        return {
          c: FETCH_ERRORS.NODE_NOT_EXISTS,
          db: `Block doesn't exist`,
          usr: `Block doesn't exist`,
        }
      } else if (existResult === 'm') {
        addrExistMisses++
      }
      const hit = await cache.get<CachedAddress>(addressId)
      if (isCacheSuccess(hit)) {
        addrHits++
        debug(`Cache hit ${hit.s.id}`)
        addressHit = hit.s
        // Emit even stale address because it's better than nothing
        if (includeAddress) {
          yield [hit.s]
        }
      } else {
        addrMisses++
        debug(`Cache miss ${addressId} ${hit.f}`)
        /*if (hit.f === MissType.NOT_EXIST) {
          return {
            c: FETCH_ERRORS.NODE_NOT_EXISTS,
            db: `Address doesn't exist`,
            usr: `Address doesn't exist`,
          }
        }*/
      }

      // Step 2: Try loading relations from cache and progress the cursor
      let curCursor = cursor
      let addressRelsHit = false
      if (addressHit) {
        const localHits = loadAllCachedAddressRelations(curCursor, !cacheIsFree)
        while (true) {
          const next = await localHits.next()
          debug(`Cache hit addr batch ${next.value?.map((v) => v.id)}`)
          if (next.done) {
            break
          } else {
            const rels = next.value
            if (rels.length > 0) {
              addressRelsHit = true
              curCursor = getNextCursor(curCursor, rels)
              yield rels
            }
          }
        }
      }

      const addressStale = addressHit
        ? new Date().getTime() - Number(fromRadix252(addressHit.ts)) > MAX_ADDRESS_AGE_TILL_STALE
        : true
      if (!addressStale && addressRelsHit) {
        debug(`Addr is fresh, returning early ${addressId}`)
        return
      }

      // From here on out the cache does no good
      if (cacheOnly) {
        debug(`Cache only mode, returning empty results ${addressId}`)
        return
      }

      // Step 3: Cached rels are incomplete or last check is stale, refresh
      // the last seen cursor and update address's associated timestamp
      const relFetch = fetcher.fetchAddressRels(curCursor, addressStale)
      const relBatch: AddressRelations[] = []
      while (true) {
        const next = await relFetch.next()
        if (!next.done) {
          const relationsOnly = next.value.filter((a) => !isGraphNode(a)) as AddressRelations[]
          const nodesOnly = next.value.filter((a) => isGraphNode(a)) as FullAddress[]
          debug(`Cache Loaded ${relationsOnly.length} / ${nodesOnly.length} rel/nodes`)
          if (nodesOnly.length > 0) {
            const latestUpstreamNode = nodesOnly[nodesOnly.length - 1]
            const cachedAccount: CachedAddress = {
              ...latestUpstreamNode,
              ts: toRadix252(new Date().getTime() - 10000),
            }
            await cacheWrite(addressId, cachedAccount)
            if (includeAddress) {
              yield [cachedAccount]
            }
          }
          if (relationsOnly.length > 0) {
            relBatch.push(...relationsOnly)
            yield relationsOnly
          }
        } else {
          if (isErr(next.value)) {
            return next.value
          }

          // Rel batch was successfully loaded, cache for later and yield
          await cacheWrite(curCursor, relBatch)
          yield relBatch
          return
        }
      }
    },

    fetchBlock: async function* (blockId: Block['id']) {
      // randomly print cache hit / miss report
      if (Math.random() < 0.01) {
        debug(`Cache hit ratios for ${cacheSrcName}:`)
        debug(`Nodes: ${Math.floor(100.0 * nodeHits / nodeMisses)}%`)
        debug(`Node Existance: ${Math.floor(100.0 * nodeExistHits / nodeExistMisses)}%`)
        debug(`Addrs: ${Math.floor(100.0 * addrHits / addrMisses)}%`)
        debug(`Addr Existance: ${Math.floor(100.0 * addrExistHits / addrExistMisses)}%`)
      }
      const existsResult = await cache.exists(blockId)
      if (existsResult === 'n') {
        nodeExistHits++
        return {
          c: FETCH_ERRORS.NODE_NOT_EXISTS,
          db: `Transaction doesn't exist`,
          usr: `Transaction doesn't exist`,
        }
      } else if (existsResult === 'm') {
        nodeExistMisses++
      }
      const hit = await cache.get<CachedBlock>(blockId)
      if (isCacheSuccess(hit) && hit.s.r.length > 0) {
        nodeHits++
        debug(`Cache hit ${hit.s.o.id} w/ ${hit.s.r.length} rels`)
        yield [hit.s.o, ...hit.s.r]
        return
      } else if (!isCacheSuccess(hit)) {
        nodeMisses++
        debug(`Cache miss ${blockId}`)
        /*if (hit.f === MissType.NOT_EXIST) {
          return {
            c: FETCH_ERRORS.NODE_NOT_EXISTS,
            db: `Block doesn't exist`,
            usr: `Block doesn't exist`,
          }
        }*/
      }
      // Cache won't help from here
      if (cacheOnly) {
        return
      }
      const fresh = fetcher.fetchBlock(blockId)
      let block: Block = { id: blockId }
      let rels: (BlockRelations | TransactionRelations)[] = []
      while (true) {
        const next = await fresh.next()
        if (!next.done) {
          debug(`Cache remotely fetched ${next.value.map((v) => v.id).length} block objs`)
          for (const b of next.value) {
            if (isFullBlock(b)) {
              block = b
            } else if (isTransaction(b) || isAddress(b)) {
              yield [b]
            }
            else {
              rels.push(b)
            }
          }
          yield next.value
        } else {
          if (isErr(next.value)) {
            if (next.value.c === FETCH_ERRORS.NODE_NOT_EXISTS) {
              cache.setNotExists(blockId)
            }
            return next.value
          }
          // Load was success, stuff final blob in cache
          const cachedBlock: CachedBlock = {
            o: block as FullBlock,
            r: rels,
          }
          await cacheWrite(blockId, cachedBlock)
          return
        }
      }
    },
    fetchTransaction: async function* (transactionId: Transaction['id']) {
      const existsResult = await cache.exists(transactionId)
      if (existsResult === 'n') {
        nodeExistHits++
        return {
          c: FETCH_ERRORS.NODE_NOT_EXISTS,
          db: `Transaction doesn't exist`,
          usr: `Transaction doesn't exist`,
        }
      } else if (existsResult === 'm') {
        nodeExistMisses++
      }
      const hit = await cache.get<CachedTransaction>(transactionId)
      if (isCacheSuccess(hit) && hit.s.r.length > 0) {
        nodeHits++
        debug(`Cache hit ${hit.s.o.id} w/ ${hit.s.r.length} rels`)
        yield [hit.s.o, ...hit.s.r]
        return
      } else if (!isCacheSuccess(hit)) {
        nodeMisses++
        /*if (hit.f === MissType.NOT_EXIST) {
          return {
            c: FETCH_ERRORS.NODE_NOT_EXISTS,
            db: `Transaction doesn't exist`,
            usr: `Transaction doesn't exist`,
          }
        }*/
      }
      // Cache won't help from here
      if (cacheOnly) {
        return
      }
      const fresh = fetcher.fetchTransaction(transactionId)
      let transaction: Transaction = { id: transactionId }
      let rels: TransactionRelations[] = []
      while (true) {
        const next = await fresh.next()
        if (!next.done) {
          debug(
            `Cache loaded ${JSON.stringify(next.value.map((v) => v.id))} for ${transactionId}`
          )
          for (const t of next.value) {
            if (isFullTransaction(t)) {
              debug(`Saw tx ${t.id}`)
              transaction = t
            } else if (isFullBlock(t)) {
              yield [t]
            } else {
              debug(`Saw tx-rel ${t.id}`)
              rels.push(t)
            }
          }
          yield next.value
        } else {
          if (isErr(next.value)) {
            if (next.value.c === FETCH_ERRORS.NODE_NOT_EXISTS) {
              cache.setNotExists(transactionId)
            }
            return next.value
          }
          // Load was success, stuff in cache
          const cachedTransaction: CachedTransaction = {
            o: transaction as FullTransaction,
            r: rels,
          }
          await cacheWrite(transactionId, cachedTransaction)
          return
        }
      }
    },
    // Pass-thru to real impl
    requestServerPush: fetcher.requestServerPush,
  }
}
