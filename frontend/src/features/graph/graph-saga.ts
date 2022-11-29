import { StrictEffect } from '@redux-saga/types'
import isEqual from 'lodash.isequal'
import { call, delay, fork, put, select, take } from 'redux-saga/effects'
import { RootState } from '../../app/store'
import { FETCH_ERRORS, GraphCursor, GraphFetcher, isErr, NodeErr } from './global/fetch-contract'
import {
  Address,
  ADDRESS_TYPE,
  Block,
  BLOCK_TYPE,
  FullNodes,
  GraphNodes,
  GraphObjs,
  isFullNode,
  isGraphNode,
  isPaginatedNodeId,
  isRelation,
  newHexValuedId,
  newNumberValuedId, PaginatedNode, Relations,
  Transaction,
  TRANSACTION_TYPE
} from './global/types'
import { assertUnreachable, hexToRadix252, instrumentDebug } from './global/utils'
import { focusCam } from './Graph'
import { fetchNode, fetchRelsPage, fetchTimeline, findTopNRelationsNearestTo, greedyBFS } from './graph-algos'
import { localFetcher, remoteFetcher } from './graph-fetchers'
import {
  AGraphBulkUpdated,
  AHistoricQueryChanged,
  ANetErrorred,
  ANodeNotFound, ANodeSelected, ANodesReffed, AQueried, ASearchLoaded, ASearchLoading, ASelectedRelsPageLoaded,
  ASetLatestNotification,
  ASetLRUOrder,
  ATimelineAppended,
  ATimelineMarkSet, LoadLatestBlockSpec,
  LoadNodeSpec,
  LoadTimelineMarkSpec,
  QuerySpec,
  SearchSpec,
  staticState
} from './graph-reducer'
import { getHumanName, TIME_TILL_FREEZE } from './rendering'

// Buffer up to this many elements before
// yielding graph state changes, batching
// UI updates greating increases performance!
const YIELD_BUFFER_SIZE = 100
const MAX_TIMELINE_RELATIONS = 50
const MAX_PAGINATABLE_VISIBLE_RELATIONS = 100
//const FETCH_NEXT_PAGES_COUNT = 10

const debug = instrumentDebug('graph-saga')

function graphObjBuffer(minBufferSize: number, maxIdleTime: number) {
  const refNodes: GraphNodes[] = []
  const fullNodes: FullNodes[] = []
  const rels: Relations[] = []
  let lastFlushTime = new Date().getTime()

  return (batchToPut: GraphObjs[], flush: boolean = false) => {
    const batchTime = new Date().getTime()
    // Flush and return any overflows
    const toReturn = {
      rels: [] as Relations[],
      refNodes: [] as GraphNodes[],
      fullNodes: [] as FullNodes[],
    }

    const forceFlush = flush || (batchTime - lastFlushTime > maxIdleTime)

    batchToPut.forEach((nOrR) => {
      if (isRelation(nOrR)) {
        rels.push(nOrR)
      } else if (isFullNode(nOrR)) {
        fullNodes.push(nOrR)
      } else {
        refNodes.push(nOrR)
      }
    })

    if (fullNodes.length >= minBufferSize || forceFlush) {
      toReturn.fullNodes = fullNodes.splice(0, fullNodes.length)
    }
    if (rels.length >= minBufferSize || forceFlush) {
      toReturn.rels = rels.splice(0, rels.length)
    }
    if (refNodes.length >= minBufferSize || forceFlush) {
      toReturn.refNodes = refNodes.splice(0, refNodes.length)
    }

    if (toReturn.refNodes.length + toReturn.rels.length + toReturn.fullNodes.length > 0) {
      lastFlushTime = new Date().getTime()
    }

    return toReturn
  }
}

function actionBuffer(minBufferSize: number, maxIdleTime: number) {
  const buffer = graphObjBuffer(minBufferSize, maxIdleTime)
  return (batch: GraphObjs[], flush: boolean = false) => {
    const buffed = buffer(batch, flush)
    const bulk: AGraphBulkUpdated = {
      type: 'GraphBulkUpdate',
      rels: [],
      refs: [],
      loaded: [],
    }
    if (buffed.fullNodes.length > 0) {
      bulk.loaded = buffed.fullNodes
    }
    if (buffed.refNodes.length > 0) {
      bulk.refs = buffed.refNodes.map((n) => n.id)
    }
    // Rels are a special case, when flushing them all nodes must also be flushed since
    // they are a prereq for the rels
    if (buffed.rels.length > 0) {
      const { refNodes, fullNodes, rels } = buffer([], true)
      bulk.rels = [...buffed.rels, ...rels]
      bulk.loaded = [...buffed.fullNodes, ...fullNodes]
      bulk.refs = [...buffed.refNodes, ...refNodes].map((n) => n.id)
    }
    const isFlushed = bulk.rels.length + bulk.refs.length + bulk.loaded.length > 0
    return isFlushed ? bulk : undefined
  }
}

function* newGraphSaga(remoteFetcher: GraphFetcher, localFetcher: GraphFetcher) {

  // TODO: make appended more batch-friendly and speed this up!
  const loadTimeline = function* (node: PaginatedNode, fetcher: GraphFetcher): ActionGen {
    const fetching = fetchTimeline(node.id, fetcher)
    let timelineChunk = (yield call(() => fetching.next())) as Awaited<
      ReturnType<typeof fetching.next>
    >
    while (true) {
      if (isErr(timelineChunk)) {
        yield put(toNodeErrAction(node.id, timelineChunk))
      }
      if (!timelineChunk.done) {
        const nextTimelineChunk = (yield call(() => fetching.next())) as Awaited<
          ReturnType<typeof fetching.next>
        >
        const timelineAppendAction: ATimelineAppended = {
          type: 'TimelineAppended',
          node: node.id,
          timeline: timelineChunk.value,
          isFullyLoaded: nextTimelineChunk.done || false,
        }
        yield put(timelineAppendAction)
        timelineChunk = nextTimelineChunk
      } else {
        return
      }
    }
  }

  // Pre-fetch next relation pages in ascending time order to warm the cache
  /*const prefetchNextPages = function* (nodeId: PaginatedNode['id'], lastKnownRel: Relations, maxPages: number, fetcher: GraphFetcher): ActionGen {
    if (maxPages <= 0) {
      return
    }
    const curCursor = toCursor(nodeId, lastKnownRel)
    const fetching = fetchRelsPage(fetcher, curCursor)
    while (true) {
      const next = fetching.next()
      const fetched = (yield call(() => next)) as Awaited<
        ReturnType<typeof fetching.next>
      >
      debug(`Prefetched batch for ${nodeId}`)
      if (fetched.done) {
        debug(`Prefetch done for ${nodeId}`)
        return
      }
    }
  }*/

  const toNodeErrAction = function (nodeId: GraphNodes['id'], err: NodeErr): ANetErrorred | ANodeNotFound {
    const errType = err.c
    if (errType === FETCH_ERRORS.NODE_NOT_EXISTS) {
      return { type: 'NodeNotFound', message: `Couldn't find ${getHumanName(nodeId)}` }
    } else if (errType === FETCH_ERRORS.NETWORK_ERROR) {
      return {
        type: 'NetError',
        msg: err.usr,
      }
    } else {
      assertUnreachable(errType)
    }
  }

  const selectNode = function* (nodeId: GraphNodes['id']): ActionGen {
    const state = ((yield select()) as RootState).graph
    if (state.settings.autoFocus) {
      const renderedNode = staticState.peekRenderedNode(nodeId)
      if (renderedNode) {
        focusCam(renderedNode)
      }
    }
    debug(`Select ${nodeId}`)
    const selectAction: ANodeSelected<GraphNodes['id']> = {
      type: 'NodeSelect',
      nodeId: nodeId,
      prevId: undefined
    }

    yield put(selectAction)

    return undefined
  }

  const loadNode = function* (nodeId: GraphNodes['id'], options: {
    selectNode: boolean,
    emitRefAction: boolean,
    emitErr: boolean,
    emitHistory: boolean,
    isExternal: boolean,
  }): ActionGen<undefined | NodeErr> {
    debug(`Load node ${nodeId}`)

    const handlePagination = isPaginatedNodeId(nodeId)
    const bufferSize = handlePagination ? Number.POSITIVE_INFINITY : YIELD_BUFFER_SIZE
    const bufferTime = handlePagination ? Number.POSITIVE_INFINITY : (TIME_TILL_FREEZE + 1)
    const buffer = actionBuffer(bufferSize, bufferTime)
    const fetching = fetchNode(remoteFetcher, nodeId)

    if (options.emitHistory) {
      const loadSpec: LoadNodeSpec = {
        nId: nodeId,
        t: '0',
        sel: options.selectNode ? '1' : '0',
      }
      yield* setHistoricQuery(loadSpec, options.isExternal)
    }
    if (options.emitRefAction) {
      const refAction: ANodesReffed = { type: 'NodesRef', nodeIds: [nodeId] }
      yield put(refAction)
    }
    if (options.emitRefAction && options.selectNode) {
      yield* selectNode(nodeId)
    }
    while (true) {
      const next = fetching.next()
      const fetched = (yield call(() => next)) as Awaited<
        ReturnType<typeof fetching.next>
      >
      if (fetched.done) {
        if (isErr(fetched.value)) {
          if (options.emitErr) {
            yield put(toNodeErrAction(nodeId, fetched.value))
          }
          return fetched.value
        }

        const bulkAction = buffer([], true)
        if (bulkAction) {
          debug(`Put Bulk load for ${nodeId}`)
          yield put(bulkAction)
        }
        // Select now that it's loaded if a ref wasn't already selected
        if (!options.emitRefAction && options.selectNode) {
          yield* selectNode(nodeId)
        }
        if (handlePagination) {
          const node = bulkAction?.loaded!.find((l) => l.id === nodeId) as PaginatedNode
          const rels = bulkAction?.rels!
          // If selected node is paginatable, emit at least the initial page
          const nextPageExists = rels[rels.length - 1].ts !== node.ts
          const firstPageLoadAction: ASelectedRelsPageLoaded = {
            type: 'SelectedRelsPageLoaded',
            nodeId: node.id,
            timelineRels: rels.slice(0, MAX_TIMELINE_RELATIONS),
            visibleRels: rels.slice(0, MAX_PAGINATABLE_VISIBLE_RELATIONS),
            intendedTimelineMark: 0,
          }
          debug(`Put first page load for ${nodeId}`)
          yield put(firstPageLoadAction)
          // Special case: If node was selected + paginatable, load the timeline + preload some extra pages
          if (nextPageExists && rels.length > 0) {
            // Load the timeline
            debug(`Loading timeline...`)
            yield* loadTimeline(node, remoteFetcher)
            debug(`Prefetching pages...`)
            //const lastRemoteRel = yield* prefetchNextPages(nodeId, rels[rels.length - 1], PREFETCH_PAGES_COUNT, remoteFetcher)
          }
        }

        if (options.selectNode) {
          yield* loadGreedyBfs([nodeId], 100, 2)
        }
        return
      } else {
        const fetchedRels = (fetched.value as GraphObjs[]).filter((v) =>
          isRelation(v)
        ) as Relations[]
        const fetchedNodes = (fetched.value as GraphObjs[]).filter((v) =>
          isGraphNode(v)
        ) as FullNodes[]
        if (fetchedNodes.length > 0) {
          const bulkAction = buffer(fetchedNodes)
          if (bulkAction) {
            yield put(bulkAction)
          }
        }
        if (fetchedRels.length > 0) {
          const bulkAction = buffer(fetchedRels)
          if (bulkAction) {
            yield put(bulkAction)
          }
        }
      }
    }
  }

  /*const loadNodesParrallel = function* (nodeIds: GraphNodes['id'][]): ActionGen {
    let generators = nodeIds.map((node) => loadNode(node, false))
    const forks = [] as StrictEffect[]
    for (const gen of generators) {
      forks.push(call(() => gen.next()) as StrictEffect)
    }
    yield all(forks)
    return
  }

  const loadNodesSerially = function* (nodeIds: GraphNodes['id'][]): ActionGen {
    const generators = nodeIds.map((node) => loadNode(node, false))
    for (const gen of generators) {
      yield* gen
    }
    return
  }*/

  const loadGreedyBfs = function* (
    nodeIds: GraphNodes['id'][],
    maxVisibleNodes: number,
    maxDepth: number
  ): ActionGen {
    const allAddedNodes: Record<GraphNodes['id'], GraphNodes> = {}
    const buffer = actionBuffer(YIELD_BUFFER_SIZE, TIME_TILL_FREEZE + 1)
    const gbfsGen = greedyBFS(nodeIds, maxVisibleNodes, maxDepth, localFetcher)
    const yieldedNodes = new Set<GraphNodes['id']>()
    while (true) {
      const nextBFSBatch = (yield call(() => gbfsGen.next())) as Awaited<
        ReturnType<typeof gbfsGen.next>
      >
      // Once done, dispatch a prioritize visible action
      if (nextBFSBatch.done) {
        // Reverse the BFS order so search leaves are lowest priority
        for (const nodeId of nodeIds) {
          yieldedNodes.add(nodeId)
        }
        const lowestToHighestPriorities = Array.from(yieldedNodes)
        lowestToHighestPriorities.reverse()

        const bulkAction = buffer([], true)
        if (bulkAction) {
          yield put(bulkAction)
        }

        // Set order of importance for LRU goodness
        const lruAction: ASetLRUOrder = {
          type: 'SetLRUOrder',
          nodes: lowestToHighestPriorities,
        }
        yield put(lruAction)

        return undefined
      } else {
        const batch = nextBFSBatch.value as GraphObjs[]
        if (batch.length > 0) {
          const allNodes = batch.filter((b) => isGraphNode(b)) as GraphNodes[]
          const allNodeIds = allNodes.map((n) => n.id)
          for (const nId of allNodeIds) {
            yieldedNodes.add(nId)
          }

          const bulkAction = buffer(batch)
          if (bulkAction) {
            yield put(bulkAction)
          }
        }
      }
    }
  }

  const loadLatestBlock = function* (
    spec: LoadLatestBlockSpec,
    emitHistory: boolean,
    isExternal: boolean,
  ): ActionGen {
    const blockNumber = +spec.c
    const maxVisibleNodes = +spec.m
    const latestBlock = { id: newNumberValuedId(blockNumber, BLOCK_TYPE) } as Block
    if (emitHistory) {
      yield* setHistoricQuery(spec, isExternal)
    }
    yield* loadNode(latestBlock.id, {
      selectNode: true, emitRefAction: true, emitErr: true, emitHistory: false, isExternal
    })
    yield* loadGreedyBfs([latestBlock.id], Math.min(maxVisibleNodes, 100), 2)
    return
  }

  // Simply load a whole cursor page, no fancy generators or state changes
  const fetchPageAsBatch = async function (page: GraphCursor): Promise<Relations[] | NodeErr> {
    const fetching = fetchRelsPage(remoteFetcher, page)
    const batch: Relations[] = []
    while (true) {
      const next = await fetching.next()
      if (next.done) {
        if (isErr(next.value)) {
          return next.value;
        }
        return batch
      } else {
        const fetchedRels = (next.value as GraphObjs[]).filter((v) =>
          isRelation(v)
        ) as Relations[]
        batch.push(...fetchedRels)
      }
    }
  }

  const loadTopNRelationsNearestTo = function* (spec: LoadTimelineMarkSpec): ActionGen {
    const { n: nodeId, m: timelineMark, f: page1, s: page2 } = spec
    const timelineSetAction: ATimelineMarkSet = {
      type: 'TimelineMarkSet',
      mark: +timelineMark,
    }
    yield put(timelineSetAction)

    debug('aaa loadTopN')
    // Fetch both pages and filter down to those nearest the "near" date
    const pendingFirstPage = fetchPageAsBatch(page1)
    const pendingSecondPage = page2 ? fetchPageAsBatch(page2) : Promise.resolve([] as Relations[])
    const allLoadedArr = (yield call(() => Promise.all([pendingFirstPage, pendingSecondPage]))) as Awaited<ReturnType<typeof fetchPageAsBatch>>[]
    const allLoaded = allLoadedArr.flat()
    const allErrors = allLoaded.filter((relOrErr) => isErr(relOrErr)) as NodeErr[]

    debug('all loaded: ' + JSON.stringify(allLoaded))

    if (allErrors.length > 0) {
      yield put(toNodeErrAction(nodeId, allErrors[0]))
      return
    }
    const allRels = allLoaded as Relations[]

    const { nearest: visibleRels } = findTopNRelationsNearestTo(+timelineMark, MAX_PAGINATABLE_VISIBLE_RELATIONS, allRels)
    const { nearest: timelineRels } = findTopNRelationsNearestTo(+timelineMark, MAX_TIMELINE_RELATIONS, allRels)
    yield put({
      type: 'SelectedRelsPageLoaded',
      visibleRels,
      timelineRels,
      nodeId,
      intendedTimelineMark: +timelineMark,
    } as ASelectedRelsPageLoaded)
  }

  const hexRegex = /0?x?[0-9a-f]+/
  function asHexNoPrefix(lowercase: string): string | null {
    if (hexRegex.test(lowercase)) {
      return lowercase.replace('0x', '')
    }
    return null
  }

  const SEARCH_TIP = 'Try searching addresses, transaction hashes, block numbers or .eth addresses'
  const loadSearch = function* (spec: SearchSpec, isExternal: boolean): ActionGen {
    debug('search ' + spec.s)
    const searchLoadedAction = { type: 'SearchLoaded' } as ASearchLoaded

    yield* setHistoricQuery(spec, isExternal)
    yield put({ type: 'SearchLoading' } as ASearchLoading)

    const asBlockNumber = +spec.s
    const hex = asHexNoPrefix(spec.s)
    const matchErrs: NodeErr[] = []
    let succeeded = false

    // Case 1: Block number
    if (spec.s.length < 20 && Number.isInteger(asBlockNumber) && asBlockNumber >= 0) {
      const blockId = newNumberValuedId(asBlockNumber, BLOCK_TYPE) as Block['id']
      yield* loadNode(blockId, { selectNode: true, emitErr: true, emitRefAction: true, emitHistory: false, isExternal: false })
      yield put(searchLoadedAction)
      return
    }
    else if (spec.s.endsWith('.eth')) {
      // TODO!
      yield put(searchLoadedAction)
    }
    // Case 3: Address / Transaction hash?
    else if (hex) {
      const asAddressId = newHexValuedId(hex, ADDRESS_TYPE) as Address['id']
      debug('aaaa Loading addr ' + asAddressId)
      const addressErr = yield* loadNode(asAddressId, { emitRefAction: false, selectNode: true, emitErr: false, emitHistory: false, isExternal: false })
      if (!addressErr) {
        // Select the address and done
        //yield put({ type: 'NodeSelect', nodeId: asAddressId } as ANodesSelected)
        succeeded = true
      } else {
        debug('aaaa Err addr ' + asAddressId)
        matchErrs.push(addressErr)
        const asTransactionId = `${TRANSACTION_TYPE},${hexToRadix252(hex)}` as Transaction['id']
        const transactionErr = yield* loadNode(asTransactionId, { emitRefAction: false, selectNode: true, emitErr: false, emitHistory: false, isExternal: false })
        if (!transactionErr) {
          // Select the address and done
          //yield put({ type: 'NodeSelect', nodeId: asTransactionId } as ANodesSelected)
          succeeded = true
        } else {
          matchErrs.push(transactionErr)
        }
      }
    }

    // No good search?
    yield put(searchLoadedAction)

    // Else distingish between failed search or failed network
    const firstNetErr = matchErrs.find((err) => err.c === FETCH_ERRORS.NETWORK_ERROR)
    if (!succeeded) {
      if (firstNetErr) {
        const errAction: ASetLatestNotification = {
          type: 'SetLatestNotification',
          msg: 'There was a network error, check connection and try again.',
          t: 'warning'
        }
        yield put(errAction)
      }
      else {
        yield put({
          type: 'SetLatestNotification',
          msg: `No results. ${SEARCH_TIP}`,
          t: 'warning',
        } as ASetLatestNotification)
      }
    }
  }

  // Warning! When calling this, ensure it's the first put() of the saga! Otherwise
  // complex races with Url state become a thing in Graph.tsx
  function* setHistoricQuery(spec: QuerySpec, isExternal: boolean): ActionGen {
    const historicAction = {
      type: 'HistoricQueryChanged',
      isExternal: isExternal,
      spec
    } as AHistoricQueryChanged
    yield put(historicAction)
    return undefined
  }

  const route = (action: AQueried): (() => ActionGen<any>) => {
    return () => {
      const actionType = action.spec.t
      if (actionType === '0') {
        return loadNode(action.spec.nId, {
          selectNode: action.spec.sel === '1',
          emitErr: true,
          emitRefAction: true,
          emitHistory: true,
          isExternal: !!action.isExternal
        })
      } else if (actionType === '1') {
        return loadLatestBlock(action.spec, true, !!action.isExternal)
      } else if (actionType === '3') {
        return loadTopNRelationsNearestTo(action.spec)
      } else if (actionType === '4') {
        return loadSearch(action.spec, !!action.isExternal)
      }
      assertUnreachable(actionType)
    }
  }

  function* mainInner(): ActionGen {
    let lastQuery: QuerySpec | null = null
    try {
      debug(`Waiting for Query`)
      const action = (yield take('Queried')) as AQueried
      if (action.type === 'Queried') {
        if (!action.isExternal && lastQuery && isEqual(action.spec, lastQuery)) {
          debug(`Duplicate query ignored! ${JSON.stringify(lastQuery)}`)
        }
        lastQuery = action.spec
        debug(`Query taken ${action.spec.t}`)
        // starts the task in the background
        /*const query: Task =*/ yield fork(route(action))
        debug(`Query forked ${action.spec.t}`)
      }

      // maybe fork a cancel thread here?
      // It will fork + take a Queried event which implies
      // this query was cancelled

      // wait for the user stop action
      //debug(`Awaiting next query`)
      //const nextAction = (yield take('Queried')) as AQueried
      // TODO: rate limit here after testing?
      //yield cancel(query)
      // Re-put the action just stolen for re-processing
      //debug(`Next query re-put...`)
      //yield put(nextAction)
    } catch (e) {
      debug(e as Error)
      yield delay(200)
    }
    return
  }

  while (true) {
    yield* mainInner()
  }
}

export const graphSaga = newGraphSaga(remoteFetcher, localFetcher)

type ActionGen<RETURN = undefined> = Generator<StrictEffect, RETURN, unknown>
