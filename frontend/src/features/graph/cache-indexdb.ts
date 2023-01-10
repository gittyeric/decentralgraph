import { Cache, CacheKey, CacheValue, MissType } from './global/fetch-cache'
import { GraphCursor, isErr } from './global/fetch-contract'
import { PaginatedNode } from './global/types'
import { instrumentDebug } from './global/utils'
const { extendPrototypeResult: localforage } = require('localforage-indexes')
const lruDriver = require('localforage-lru-driver')

type DiskDriver = {
  setItem(key: string, val: string): Promise<void>
  getItem(key: string): Promise<string | undefined>
}

const debug = instrumentDebug('cache-indexdb')

let _diskDriver: Promise<DiskDriver>;
async function getDiskDriver(): Promise<DiskDriver> {
  if (_diskDriver) {
    return _diskDriver;
  }
  _diskDriver = localforage.defineDriver(lruDriver).then(function () {
    var lf = localforage.createInstance({
      driver: 'lruStorage',
      cacheSize: 200000,
      lruKey: 'ts',
      lruIndex: 'dg',
    })

    lf.ready()
    return lf
  });
  return _diskDriver
}

const get = async <V extends CacheValue>(key: CacheKey) => {
  try {
    const start = new Date().getTime()
    const hit = await getDiskDriver().then(async (driver) => {
      const gotten = await driver.getItem(key)
      debug(`Get idb ${new Date().getTime() - start}ms`)
      return gotten
    })
    if (typeof hit === 'string') {
      return {
        s: JSON.parse(hit) as V,
      }
    }
  } catch (e) {
    debug(e as Error)
  }
  return {
    f: MissType.CACHE_MISS,
  }
}

export const indexDbCache: Cache = {
  exists: async (key: CacheKey) => {
    const gotten = await get(key)
    return isErr(gotten) ? 'm' : 'y'
  },
  // No need to impl, mem cache has this covered basically
  setNotExists: async (key: CacheKey) => { },
  get,
  set: async (key: CacheKey, val: CacheValue) => {
    try {
      const driver = await getDiskDriver()
      await driver.setItem(key, JSON.stringify(val))
    } catch (e) {
      debug(e as Error)
    }
  },
  getTimeline: async (key: PaginatedNode['id']) => null, // Maybe impl one day I guess
  setTimeline: async (key: PaginatedNode['id'], timeline: GraphCursor[]) => { }, // Maybe impl one day I guess
}
