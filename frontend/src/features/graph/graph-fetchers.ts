import { indexDbCache } from "./cache-indexdb"
import { newMemLruCache } from "./global/cache-mem"
import { cachedGraphFetcher } from "./global/fetch-cache"
import { newRandomGraphFetcher } from "./global/fetch-random"
import { newWsFetcher } from "./global/fetch-ws"
import { CLIENT_REQUEST_TIMEOUT, STAY_LOCAL, WEBSOCKET_URL } from '../../config'
import { MAX_POSSIBLE_VISIBLE_NODES } from "./global/tuning"

// Construct the super cached fetcher + static state source
const fetchLruCache = newMemLruCache(
  MAX_POSSIBLE_VISIBLE_NODES, // entries to remember for syncronous lookup
  50,
  100,
  1000 * 60 * 60 * 2,
)

// Random fetching for testing
function getRandomFetchers() {
  const iDbRemoteRandomFetcher = cachedGraphFetcher(
    indexDbCache,
    newRandomGraphFetcher(),
    true,
    'idb'
  )
  const iDbLocalRandomFetcher = cachedGraphFetcher(
    indexDbCache,
    newRandomGraphFetcher(),
    true,
    'idb',
    true
  )
  const remoteFetcher = cachedGraphFetcher(fetchLruCache, iDbRemoteRandomFetcher, false, 'mem')
  const localFetcher = cachedGraphFetcher(fetchLruCache, iDbLocalRandomFetcher, true, 'mem')
  return { localFetcher, remoteFetcher }
}

// Prod remote fetching
function getRemoteFetchers() {
  const wsFetcher = newWsFetcher(WEBSOCKET_URL, CLIENT_REQUEST_TIMEOUT).fetcher
  const iDbRemoteFetcher = cachedGraphFetcher(
    indexDbCache,
    wsFetcher,
    true,
    'idb',
    false,
  )
  const iDbLocalFetcher = cachedGraphFetcher(
    indexDbCache,
    wsFetcher,
    true,
    'idb',
    true
  )
  const remoteFetcher = cachedGraphFetcher(fetchLruCache, iDbRemoteFetcher, false, 'mem')
  const localFetcher = cachedGraphFetcher(fetchLruCache, iDbLocalFetcher, true, 'mem')
  return { localFetcher, remoteFetcher }
}

const fetchers = STAY_LOCAL ? getRandomFetchers() : getRemoteFetchers()

export const remoteFetcher = fetchers.remoteFetcher
export const localFetcher = fetchers.localFetcher
