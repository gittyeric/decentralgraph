import LRU from 'lru-cache'
import { CachedNode, CacheKey, CacheValue, isCachedAddress, MissType } from './fetch-cache'
import { GraphCursor } from './fetch-contract'
import { PaginatedNode } from './types'

export function newMemLruCache(
  maxNodes: number,
  maxNodeMisses: number,
  maxTimelines: number,
  timelineTtl: number,
) {
  const graphObjLru = new LRU<CacheKey, CacheValue>({
    max: maxNodes,
  })

  const timelineLru = new LRU<PaginatedNode['id'], GraphCursor[]>({
    max: maxTimelines,
    ttl: timelineTtl,
  })

  const notExistLru = new LRU<CacheKey, true>({
    max: maxNodeMisses,
  })

  const get = async <V extends CacheValue>(key: CacheKey) => {
    const hit = graphObjLru.get(key)
    if (typeof hit === 'string') {
      return { s: hit as V }
    } else {
      return {
        f: MissType.CACHE_MISS,
      }
    }
  }

  const getSync = (key: CacheKey) => {
    const ret = graphObjLru.get(key) as CacheValue
    return ret
  }

  return {
    // You get to cheat with in-mem!
    getSync,
    peekSync: (key: CacheKey) => {
      return graphObjLru.peek(key) as CacheValue
    },
    peekNodeSync: (key: CacheKey) => {
      const hit = graphObjLru.peek(key) as CachedNode
      if (hit) {
        if (isCachedAddress(hit)) {
          return hit
        }
        return hit.o
      }
      return undefined
    },
    getNodeSync: (key: CacheKey) => {
      const hit = getSync(key) as CachedNode
      if (hit) {
        if (isCachedAddress(hit)) {
          return hit
        }
        return hit.o
      }
      return undefined
    },
    hasSync: (key: CacheKey) => {
      return graphObjLru.has(key)
    },

    // For realz now, async interfaces
    exists: async (key: CacheKey) => {
      return notExistLru.has(key) ? 'n' : (graphObjLru.has(key) ? 'y' : 'm')
    },
    setNotExists: async (key: CacheKey) => {
      notExistLru.set(key, true)
    },
    get,
    set: async (key: CacheKey, val: CacheValue) => {
      graphObjLru.set(key, val)
    },
    getTimeline: async (key: PaginatedNode['id']) => {
      // TODO
      //return timelineLru.get(key) || null
      return null
    },
    setTimeline: async (key: PaginatedNode['id'], timeline: GraphCursor[]) => {
      // TODO
      //timelineLru.set(key, timeline)
    }
  }
}
