import {
  AddressObjsGenerator,
  AddressTimelineGenerator,
  BlockObjsGenerator, GraphCursor,
  GraphFetcher,
  isErr,
  NodeErr,
  parseCursor,
  startCursor,
  TransObjsGenerator
} from './global/fetch-contract'
import {
  Address, Block, getSourceDestFromRel,
  GraphNodes,
  GraphObjs, isAddressId, isBlockId,
  isGraphNode,
  isTransactionId,
  PaginatedNode,
  Relations,
  Transaction
} from './global/types'
import { assertUnreachable, froRadix252, instrumentDebug, raceAndRelease } from './global/utils'

const debug = instrumentDebug('graph-algos')

export function fetchNode(
  f: GraphFetcher,
  id: GraphNodes['id']
): AddressObjsGenerator | BlockObjsGenerator | TransObjsGenerator {
  debug(`fetchNode ${id}`)
  if (isAddressId(id)) {
    return f.fetchAddressRels(startCursor(id as Address['id']), true)
  } else if (isBlockId(id)) {
    return f.fetchBlock(id as Block['id'])
  } else if (isTransactionId(id)) {
    return f.fetchTransaction(id as Transaction['id'])
  }
  assertUnreachable(id)
}

export function fetchTimeline(paginatable: PaginatedNode['id'], f: GraphFetcher): AddressTimelineGenerator {
  if (isAddressId(paginatable)) {
    return f.fetchAddressTimeline(paginatable)
  } else {
    assertUnreachable(paginatable)
  }
}

export function fetchRelsPage(
  f: GraphFetcher,
  cursor: GraphCursor
): AddressObjsGenerator {
  const nodeId = parseCursor(cursor).id;
  if (isAddressId(nodeId)) {
    return f.fetchAddressRels(cursor, false);
  }
  assertUnreachable(nodeId);
}

export function findTopNRelationsNearestTo(nearMs: number, nClosestCount: number, timeSortedRels: Relations[]): {
  nearest: Relations[],
  startIndex: number,
  endIndex: number,
} {
  // Could do a binary search but meh
  let closestIndexToNear = 0
  let closestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < timeSortedRels.length; i++) {
    const relTs = Number(froRadix252(timeSortedRels[i].ts))
    const dist = Math.abs(relTs - nearMs)
    if (dist < closestDistance) {
      closestIndexToNear = i
      closestDistance = dist
    } else {
      break
    }
  }

  // With the closest index to near at hand, slice the final nearest relations
  const startIndex = Math.max(0, closestIndexToNear - nClosestCount / 2)
  const endIndex = Math.min(timeSortedRels.length, startIndex + nClosestCount)
  const nearest = timeSortedRels.slice(startIndex, endIndex)
  return {
    startIndex,
    endIndex,
    nearest
  }
}

export type GraphObjsGenerator = AsyncGenerator<GraphObjs[], NodeErr[], undefined>
export async function* fetchNodes(
  f: GraphFetcher,
  ids: GraphNodes['id'][]
): GraphObjsGenerator {
  const gens = ids.map((id) => fetchNode(f, id))
  const errs = [] as NodeErr[]
  for (let gen of gens) {
    for await (const y of gen) {
      yield y
    }
    const last = await gen.next()
    if (isErr(last.value)) {
      errs.push(last.value)
    }
  }
  return errs
}

async function fetchAllRelations<N extends GraphNodes>(
  nodeId: N['id'],
  fetcher: GraphFetcher
): Promise<Relations[]> {
  const relsIter = fetchRelations(nodeId, fetcher)
  const agg = [] as Relations[]
  while (true) {
    const next = await relsIter.next()
    if (next.done) {
      return agg
    }
    // Traverse into neighbors
    else {
      agg.push(...next.value)
    }
  }
}

async function* fetchRelations<N extends GraphNodes>(
  nodeId: N['id'],
  fetcher: GraphFetcher
): AsyncGenerator<Relations[], NodeErr | undefined, undefined> {
  if (isAddressId(nodeId)) {
    const iter = fetcher.fetchAddressRels(startCursor(nodeId), false)
    while (true) {
      const next = await iter.next()
      if (next.done) {
        return isErr(next.value) ? next.value : undefined
      }
      const rels = next.value.filter((n) => !isGraphNode(n)) as Relations[]
      if (rels.length > 0) {
        yield rels
      }
    }
  } else if (isBlockId(nodeId) || isTransactionId(nodeId)) {
    // Block or Transaction
    const iter = fetchNode(fetcher, nodeId)
    while (true) {
      const nextFullNode = await iter.next()
      if (nextFullNode.done) {
        break
      }
      // Traverse into neighbors
      else {
        const rels = (nextFullNode.value as GraphObjs[]).filter(
          (nr) => !isGraphNode(nr)
        ) as Relations[]
        if (rels.length > 0) {
          yield rels
        }
      }
    }
  } else {
    assertUnreachable(nodeId)
  }
  return undefined
}

async function* greedyBFS2(
  levelNodes: Array<GraphNodes['id']>,
  seen: Set<GraphNodes['id']>,
  maxNodesToYield: number,
  maxBFSLayers: number,
  fetcher: GraphFetcher
): AsyncGenerator<GraphObjs[], undefined, undefined> {
  const nextLevelNodes = [] as GraphNodes['id'][]
  let pendingNeighbors = [] as Promise<[GraphNodes['id'][], Relations[]]>[]
  const fullNodesGen = fetchNodes(fetcher, levelNodes)
  yield* fullNodesGen
  for (const srcNodeId of levelNodes) {
    const x = fetchAllRelations(srcNodeId, fetcher).then((nodeRels) => {
      const otherIds = [] as GraphNodes['id'][]
      for (const nr of nodeRels) {
        const relIds = getSourceDestFromRel(nr.id)
        if (relIds[0] === relIds[1]) {
          debug('Relation with same source/dest ignored: ' + nr.id)
          continue
        }
        const otherId = relIds.find((relId) => relId !== srcNodeId) as GraphNodes['id']
        if (!seen.has(otherId)) {
          seen.add(otherId)
          otherIds.push(otherId)
        }
      }
      return [otherIds, nodeRels] as [GraphNodes['id'][], Relations[]]
    })
    pendingNeighbors.push(x)
  }

  let yieldCount = 0
  let overflowed = false
  while (true) {
    if (pendingNeighbors.length === 0) {
      break
    }
    const [loadedNeighbors, pendingMinusOne] = await raceAndRelease(pendingNeighbors)
    pendingNeighbors = pendingMinusOne
    // If this batch of nodes would trip over the max, throw them away
    if (yieldCount + loadedNeighbors.length < maxNodesToYield) {
      nextLevelNodes.push(...loadedNeighbors[0])
      yieldCount += loadedNeighbors[0].length
      const toYield = [
        // Emit stubbed ref nodes
        ...loadedNeighbors[0].map((id) => ({ id: id } as GraphNodes)),
        // Emit relations to the stubbed ref nodes
        ...loadedNeighbors[1],
        ...(await Promise.all(pendingNeighbors)).map((x) => x[1]).flat()
      ]
      if (toYield.length > 0) {
        yield toYield
      }
    } else {
      overflowed = true
    }
  }

  // Lot of terminal conditions
  if (nextLevelNodes.length === 0) {
    return undefined
  }
  if (maxBFSLayers === 1) {
    return undefined
  }
  if (overflowed) {
    return undefined
  }

  const recurse = greedyBFS2(
    nextLevelNodes,
    seen,
    maxNodesToYield - yieldCount,
    maxBFSLayers - 1,
    fetcher
  )

  yield* recurse
  return undefined
}

// Yields 1 set of node Ids at a time hopped from last node Id set, grouped by the prev layers' nodes.
// But each input node Ids' neighbors greedily race to be yielded, greedy per layer but ordered by layer
export async function* greedyBFS(
  startingNodes: Iterable<GraphNodes['id']>,
  maxNodesToYield: number,
  maxBFSLayers: number,
  fetcher: GraphFetcher
): AsyncGenerator<GraphObjs[], undefined, undefined> {
  const curLevelNodes = [] as GraphNodes['id'][]
  for (const nodeId of startingNodes) {
    curLevelNodes.push(nodeId)
  }
  const gbfs = greedyBFS2(curLevelNodes, new Set(), maxNodesToYield, maxBFSLayers, fetcher)
  for (let n = await gbfs.next(); !n.done; n = await gbfs.next()) {
    yield n.value
  }
  return undefined
}
