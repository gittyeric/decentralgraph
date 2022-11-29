import { getRedis, RedisClient } from '../redis'
import { Cache, CacheKey, CacheValue, MissType } from '../../../../frontend/src/features/graph/global/fetch-cache'
import { GraphCursor, isErr, isGraphCursor } from '../../../../frontend/src/features/graph/global/fetch-contract'
import { isAddressId, isGraphNodeId, isTransactionId, PaginatedNode } from '../../../../frontend/src/features/graph/global/types'
import { instrumentDebug } from '../../../../frontend/src/features/graph/global/utils'

const ADDRESS_CACHE_TTL_SECS = 60 * 60 * 24 * 14 // Cache addresses for 2 weeks
const IMMUTABLES_CACHE_TTL_SECS = 60 * 60 * 24 * 365 // Cache immutable objs for a year

export enum BloomKeyspaces {
  TRANSACTIONS = 'tb',
  ADDRESSES = 'ab',
}

export enum RedisKeyspaces {
  GRAPH_NODES = 'g',
}

const debug = instrumentDebug('cache-redis')

const getTtlSecs = (key: CacheKey) => {
  // Addresses are mutable, so apply a TTL
  if (isAddressId(key)) {
    return ADDRESS_CACHE_TTL_SECS
  }
  // Immutable objects
  if (isGraphNodeId(key)) {
    return IMMUTABLES_CACHE_TTL_SECS
  }
  if (isGraphCursor(key)) {
    return ADDRESS_CACHE_TTL_SECS
  }
  return undefined
}

const setExMaybe = (redis: RedisClient, key: CacheKey, val: CacheValue) => {
  const ttl = getTtlSecs(key)
  if (ttl) {
    debug(`SETEX ${key}`)
    return redis.client.setEx(key, ttl, JSON.stringify(val))
  }
  debug(`SET ${key}`)
  return redis.client.set(key, JSON.stringify(val))
}

const getCuckooKey = (key: CacheKey) => {
  return isAddressId(key)
    ? BloomKeyspaces.ADDRESSES
    : isTransactionId(key)
      ? BloomKeyspaces.TRANSACTIONS
      : undefined
}

async function definatelyNotExist(redis: RedisClient, key: CacheKey): Promise<boolean> {
  const cuckooKey = getCuckooKey(key)
  if (cuckooKey) {
    const probExists = await redis.cuckoo.exists(cuckooKey, key)
    debug(`Raw cuckoo result ${probExists}`)
    if (probExists === '0') {
      return true
    }
  }
  return false
}

const get = async <V extends CacheValue>(key: CacheKey) => {
  try {
    const redis = await getRedis()
    // Phase 1: Check the Cuckoo filter for non-existance
    const pendingDefNotExists = definatelyNotExist(redis, key)

    // Phase 2: Try the actual get
    const pendingHit = redis.client.get(key)

    const hit = await pendingHit
    if (typeof hit === 'string') {
      debug(`Cache hit ${key}`)
      return {
        s: JSON.parse(hit) as V,
      }
    }
  } catch (e) {
    debug(e as Error)
    return {
      f: MissType.NETWORK_ERROR,
      db: JSON.stringify(e),
    }
  }
  debug(`Cache miss ${key}`)
  return {
    f: MissType.CACHE_MISS,
  }
}

export const redisCache: Cache = {
  exists: async (key: CacheKey) => {
    // Phase 1: Ask the Cuckoo filter for a definite no or a maybe
    try {
      const redis = await getRedis()
      const pendingGet = get(key)
      if (await definatelyNotExist(redis, key)) {
        debug(`exists returns n for ${key}`)
        return 'n'
      }

      // If Cuckoo isn't sure, try the real fetch
      return isErr(await pendingGet) ? 'm' : 'y'
    } catch (e) {
      debug(e as Error)
    }

    debug(`exists returns m for ${key}`)
    return 'm'
  },
  // Cuckoo filter pretty much handles any need for this remotely
  setNotExists: async () => { },
  get,
  set: async (key: CacheKey, val: CacheValue) => {
    const redis = await getRedis()
    await setExMaybe(redis, key, val)
  },
  getTimeline: async (key: PaginatedNode['id']) => null,
  setTimeline: async (key: PaginatedNode['id'], timeline: GraphCursor[]) => { },
}
