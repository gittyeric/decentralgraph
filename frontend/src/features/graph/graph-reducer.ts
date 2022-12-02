import { isEqual } from 'lodash'
import pick from 'lodash.pick'
import LRU from 'lru-cache'
import { Reducer } from 'redux'
import { GraphCursor, parseCursor } from './global/fetch-contract'
import {
  FullNodes,
  getSourceDestFromRel,
  GraphNodes, isAddress, isAddressId, isFullAddress, isFullNode, isTransaction, isTransactionId, PaginatedNode,
  parseHexId,
  relationId,
  Relations
} from './global/types'
import {
  ensure,
  wei252ToBigInt,
  fromRadix252,
  instrumentDebug,
} from './global/utils'
import {
  getLinkSourceId,
  getLinkTargetId,
  isRenderedNode,
  LinkView, RenderedNode
} from './rendering'

function guessBestVisibleCount() {
  const minScreenSizeScalar = 200.0
  const maxScreenSizeScalar = 2000.0
  const minVisibleCount = 300
  const maxVisibleCount = 1500

  const maxExtraCount = maxVisibleCount - minVisibleCount
  const screenScalarMin = Math.max(0, window.innerWidth - minScreenSizeScalar)
  const screenScalarMax = Math.min(screenScalarMin, maxScreenSizeScalar - minScreenSizeScalar)
  const screenScalar = screenScalarMax / (maxScreenSizeScalar - minScreenSizeScalar)

  const idealCount = Math.ceil(screenScalar * maxExtraCount + minVisibleCount)
  const humanCount = idealCount - (idealCount % 25)
  return humanCount
}

export const DEFAULT_VISIBLE_NODES = guessBestVisibleCount()

// Debug mode runs locally with no network dependencies
export const debugMode = true
const debug = instrumentDebug('graph-reducer')

// Track total balance of all visibleNodes
let addrBalanceSum = BigInt(0)

// Dangerous static state!
export type VisibleNode = [
  GraphNodes, // 0 - Data node
  RenderedNode, // 1 - Rendered node
  THREE.Object3D | null, // 2 - node's THREE representation
  boolean, // 3 - Dirty flag for rendered object at index 2
]
let visibleNodes: LRU<GraphNodes['id'], VisibleNode> = new LRU({
  max: 5000, // Set large enough to where it never overflows itself
})
let visibleLinks: LinkView[] = []
let visLinksByNode: Record<GraphNodes['id'], LinkView[]> = {}

function peekVisibleNode<N extends GraphNodes = GraphNodes>(
  nodeId: N['id']
): VisibleNode | undefined {
  return visibleNodes.peek(nodeId)
}

function peekGraphNode<N extends GraphNodes = GraphNodes>(nodeId: N['id']): N | undefined {
  const vis = peekVisibleNode(nodeId)
  return (vis ? vis[0] : undefined) as N | undefined
}

function peekRenderedNode(nodeId: GraphNodes['id']): RenderedNode | undefined {
  const vis = peekVisibleNode(nodeId)
  return (vis ? vis[1] : undefined) as RenderedNode | undefined
}

function peekNodeRelations<N extends GraphNodes = GraphNodes>(
  nodeId: N['id']
): LinkView[] | undefined {
  return visLinksByNode[nodeId]
}

function peekVisibleLinks(): LinkView[] {
  return [...visibleLinks]
}

// Get or create a buncha rendered nodes
function peekRenderedNodes(): (RenderedNode)[] {
  const poked = [] as (RenderedNode)[]
  // If rendered node doesn't exist yet, sub with data node
  visibleNodes.forEach((n: VisibleNode) => poked.push(n[1]))
  return poked
}

function peekRelation(relId: Relations['id']): LinkView | undefined {
  const ids = getSourceDestFromRel(relId)
  const immediates = [peekNodeRelations(ids[0]), peekNodeRelations(ids[1])]
    .filter((im) => !!im && im.length > 0)
    .flat() as LinkView[]
  return immediates.find((im) => im.id === relId)
}

function peekThreeObjOrSet<N extends GraphNodes>(
  nodeId: N['id'],
  factory: (oldObj?: THREE.Object3D) => THREE.Object3D
): THREE.Object3D {
  const vis = visibleNodes.peek(nodeId)
  const existing = vis && vis[2] && !vis[3] ? vis[2] : null

  if (existing) {
    return existing
  }
  const freshObj = factory()
  if (vis) {
    if (isAddressId(nodeId))
      console.log('aaaa last obj ' + nodeId + ' ' + JSON.stringify(vis[1], null, 2));
    if (vis[2]) {
      vis[2].remove()
    }
    vis[2] = freshObj
    vis[3] = false

    // Inherit previous object's position, if any
    if (isRenderedNode(vis[1])) {
      Object.assign(vis[2], pick(vis[1], ['x', 'y', 'z', 'fx', 'fy', 'fz', 'vx', 'vy', 'vz'] as (keyof RenderedNode)[]))
    }
  } else {
    ensure('Peeking for node that doesnt exist in visible set!')
  }
  return freshObj
}

export const staticState = {
  peekGraphNode,
  peekRelation,
  peekVisibleLinks,
  peekRenderedNode,
  peekRenderedNodes,
  peekNodeRelations,
  peekThreeObjOrSet,
  nodeCount: () => visibleNodes.size,
  addrBalanceSum: () => addrBalanceSum,
}

/*function _removeNodeLinks(nodeId: GraphNodes['id'], relIdsToDelete: Set<Relations['id']>): void {
  const nodeRels = visLinksByNode[nodeId]
  const removalIndexes: number[] = []
  for (let i = 0; i < nodeRels.length; i++) {
    if (relIdsToDelete.has(nodeRels[i].id)) {
      removalIndexes.push(i)
    }
  }
  _removeLinks(removalIndexes, nodeRels)
}*/

function removeVisLinksByIds(removalIds: Set<Relations['id']>): void {
  const removalIndexes: number[] = []
  for (let i = 0; i < visibleLinks.length; i++) {
    if (removalIds.has(visibleLinks[i].id)) {
      removalIndexes.push(i)
    }
  }
  removeVisLinks(removalIndexes)
}

function removeVisLinks(removalIndexes: number[]): void {
  const nodeSet = new Set<GraphNodes['id']>()
  const relDeleteSet = new Set<Relations['id']>()
  for (const ri of removalIndexes) {
    const rel = visibleLinks[ri]
    nodeSet.add(getLinkSourceId(rel))
    nodeSet.add(getLinkTargetId(rel))
    relDeleteSet.add(rel.id)
  }
  _removeLinks(removalIndexes, visibleLinks)
  for (const nodeId of nodeSet) {
    const nodeLinks = visLinksByNode[nodeId]
    const relIndexes: number[] = []
    nodeLinks.forEach((vl, i) => {
      if (relDeleteSet.has(vl.id)) {
        relIndexes.push(i)
      }
    })
    if (relIndexes.length === nodeLinks.length) {
      delete visLinksByNode[nodeId]
    } else {
      _removeLinks(relIndexes, nodeLinks)
    }
  }
}

function _removeLinks(removalIndexes: number[], removalList: (Relations | LinkView)[]): void {
  if (removalIndexes.length > 0) {
    const removeRanges: [number, number][] = []
    let rangeStart = removalIndexes[0]
    if (removalIndexes.length === 1) {
      removeRanges.push([rangeStart, rangeStart])
    }
    const limit = removalIndexes.length + 1
    for (let ri = 1; ri < limit; ri++) {
      const cur = ri === limit ? Number.POSITIVE_INFINITY : removalIndexes[ri]
      const prev = removalIndexes[ri - 1]
      // If non-continuous save cur range and create new
      if (cur - 1 !== prev) {
        removeRanges.push([rangeStart, prev])
        rangeStart = cur
      }
    }

    // Reverse the removal order to prevent the array
    // shifiting indexes around during splices
    removeRanges.reverse()

    // fastest possible array removal
    removeRanges.forEach((range) => {
      const removeCount = 1 + range[1] - range[0]
      removalList.splice(range[0], removeCount)
    })
  }
}

function deleteIslandNodes(selected: GraphNodes['id'] | null, maybeOrphans: Set<GraphNodes['id']>): VisibleNode[] {
  // Inspect all affected neighbors and remove if evicted was only neighbor
  const orphans: VisibleNode[] = []
  for (const maybeOrphanId of maybeOrphans) {
    const orphan = visibleNodes.get(maybeOrphanId) as VisibleNode
    const isOrphaned = selected !== orphan[0].id && !visLinksByNode[orphan[0].id]

    if (isOrphaned) {
      debug('Islanded node ' + maybeOrphanId + ' removed')
      orphans.push(orphan)
    }
  }

  // Delete orphans
  for (const orphan of orphans) {
    visibleNodes.delete(orphan[0].id)
  }
  // Recursively cleanup newly orphaned node links
  return cleanupDeletedNodes(selected, orphans, true)
}

// Untangle + delete deps on the just-deleted VisibleNodes,
// by removing visible relations touching it and any nodes
// that are orphaned into islands as a result, which may cause
// recursive evictions
function cleanupDeletedNodes(selected: GraphNodes['id'] | null, alreadyDeleted: VisibleNode[], assertNoNewIslands: boolean): VisibleNode[] {
  debug('Cleanup ' + alreadyDeleted.length + ' deleted nodes')
  if (alreadyDeleted.length === 0) {
    return []
  }
  debug(`Evicted ${alreadyDeleted.length} nodes, ${visibleNodes.size} remain`)
  // Remove all associated links that touch evicted nodes
  // If a removal causes a node island, also evict that node prematurely
  const dirtyNodes = new Set<GraphNodes['id']>()
  const allDeletedNodeIds = new Set(alreadyDeleted.map((ev) => ev[0].id))

  // Remove all impacted links and bookmark potential neighboring orphans
  const visRemoveIndexes: number[] = []
  for (let vi = 0; vi < visibleLinks.length; vi++) {
    const vl = visibleLinks[vi]
    const sourceId = getLinkSourceId(vl)
    const targetId = getLinkTargetId(vl)
    if (allDeletedNodeIds.has(sourceId) || allDeletedNodeIds.has(targetId)) {
      visRemoveIndexes.push(vi)
      if (!allDeletedNodeIds.has(sourceId)) {
        dirtyNodes.add(sourceId)
      }
      if (!allDeletedNodeIds.has(targetId)) {
        dirtyNodes.add(targetId)
      }
    }
  }
  // Remove all purged relations from visible sets
  removeVisLinks(visRemoveIndexes)

  const recurseDeletes = deleteIslandNodes(selected, dirtyNodes)
  if (recurseDeletes.length > 0 && assertNoNewIslands) {
    throw new Error('huh?')
  }
  return [...alreadyDeleted, ...recurseDeletes]
}

function addNodesToVisible(
  toAdd: GraphNodes[],
  selected: GraphNodes['id'] | null,
  maxVisibleNodes: number
): {
  added: GraphNodes[],
  //evicted: VisibleNode[]
} {
  // Prevent selected from being evicted
  if (selected) {
    visibleNodes.get(selected)
  }
  const added = toAdd.filter((n) => !visibleNodes.has(n.id))
  // Blindly add them all
  for (const node of added) {
    visibleNodes.set(node.id, [node, { ...node } as RenderedNode, null, true])
    if (!visLinksByNode[node.id]) {
      visLinksByNode[node.id] = []
    }
  }
  debug('Added ' + added.length + ' nodes')

  // Handle the overflow
  const evictCount = Math.max(0, visibleNodes.size - maxVisibleNodes)
  let evictedNodes = [] as VisibleNode[]
  for (let e = 0; e < evictCount; e++) {
    const evicted = visibleNodes.pop() as VisibleNode
    if (evicted[0].id !== selected) {
      evictedNodes.push(evicted)
    } else {
      visibleNodes.set(evicted[0].id, evicted)
    }
  }
  const evicted = cleanupDeletedNodes(selected, evictedNodes, false)

  for (const node of added) {
    // Update total visible node balance
    if (isFullAddress(node)) {
      addrBalanceSum += wei252ToBigInt(node.eth)
    }
  }
  for (const e of evicted) {
    if (isFullAddress(e[0])) {
      addrBalanceSum -= wei252ToBigInt(e[0].eth)
    }
  }

  return {
    added,
    //evicted,
  }
}

function addRels(rels: Relations[], selectedNode: GraphNodes['id'] | null, maxNodes: number): number {
  const newRelsMap = dedupeRels(rels, visibleLinks)
  // Collect all potential new nodes referenced by new relations
  const relNodeIds = new Set<GraphNodes['id']>()
  for (const relId in newRelsMap) {
    const srcDest = getSourceDestFromRel(relId as Relations['id'])
    for (const n of srcDest) {
      if (isTransactionId(n)) {
        debug(`Added tx as rel aka ${parseHexId(n)}`)
      }
    }
    debug(`Added rel ${relId}`)
    const [sourceId, targetId] = getSourceDestFromRel(newRelsMap[relId].id)
    addRel(sourceId, targetId, toLinkView(newRelsMap[relId]!))
    const rel = newRelsMap[relId]

    // Ensure at least new node refs exist for each end of the relation
    const [srcId, destId] = getSourceDestFromRel(rel.id)
    const unknownRefs = [
      visibleNodes.has(srcId) ? undefined : srcId,
      visibleNodes.has(destId) ? undefined : destId,
    ].filter(
      (n) => !!n
    ) as GraphNodes['id'][]
    unknownRefs.forEach((ir) => relNodeIds.add(ir))
  }

  const newRefs: GraphNodes[] = []
  for (const nodeId of relNodeIds) {
    newRefs.push({ id: nodeId } as GraphNodes)
  }
  addNodesToVisible(newRefs, selectedNode, maxNodes)
  return relNodeIds.size
}

function addRel(sourceId: GraphNodes['id'], targetId: GraphNodes['id'], rel: LinkView): void {
  visibleLinks.push(rel)
  addVisLinkByNode(sourceId, targetId, rel)
}

// TODO: remove
function azzert() {
  for (const link of visibleLinks) {
    const sourceId = getLinkSourceId(link)
    const targetId = getLinkTargetId(link)
    if (!visLinksByNode[sourceId]) {
      throw new Error('missing source from visLinksByNode')
    }
    if (!visLinksByNode[sourceId].some((vl) => vl.id === link.id)) {
      throw new Error('Rel missing from sources visLinksByNode')
    }
    if (!visLinksByNode[targetId]) {
      throw new Error('missing target from visLinksByNode')
    }
    if (!visLinksByNode[targetId].some((vl) => vl.id === link.id)) {
      throw new Error('Rel missing from targets visLinksByNode')
    }

    if (!visibleNodes.has(sourceId) || !visibleNodes.has(targetId)) {
      throw new Error('rel has nodes not in visibleNodes')
    }
  }
  if (visibleNodes.size > 0) {
    for (const x of visibleNodes.entries()) {
      if (!visibleLinks.some((vl) => {
        const sourceId = getLinkSourceId(vl)
        const targetId = getLinkTargetId(vl)
        return x[0] === targetId || x[0] === sourceId
      })) {
        //throw new Error('visibleNodes contains a node with no relations!')
      }
    }
  }
}

type ActionReducer<A extends GraphActions> = (s: GraphState, a: A) => GraphState

const routes = {} as {
  [AT in GraphActions['type']]: ActionReducer<Extract<GraphActions, { type: AT }>>
}

export type ANodesLoaded = {
  type: 'NodesLoad'
  nodes: FullNodes[]
}

routes['NodesLoad'] = (s: GraphState, a: ANodesLoaded) => {
  if (a.nodes.length === 0) {
    return s
  }
  let updated = false
  const existingNodes = a.nodes.filter((node) => visibleNodes.has(node.id))
  if (existingNodes.length > 0) {
    debug(`${existingNodes.length} duplicate nodes`)
  }

  // In-place updates of existing nodes
  for (const existingInput of existingNodes) {
    const existing = visibleNodes.get(existingInput.id) as VisibleNode
    // The only allowed update for now is from reference node to full node
    const existingUpdated = !isFullNode(existing[0]) && isFullNode(existingInput)
    updated = updated || existingUpdated
    if (existingUpdated) {
      if (isAddressId(existingInput.id)) {
        console.log('Updating to: ' + JSON.stringify(existingInput, null, 2));
        console.log('Prev val: ' + JSON.stringify(existing[0], null, 2));
      }
      // Overwrite prev data node with latest
      existing[0] = existingInput
      // Merge data changes into rendered node as well
      Object.assign(existing[1], existingInput)
      // Set the THREE Obj cache to null to invalidate
      existing[3] = true
      if (isAddressId(existingInput.id)) {
        //@ts-ignore
        console.log(`aaaa Marking obj ${existingInput.id} dirty: ` + JSON.stringify(existing[2], null, 2));
      }
    }
  }

  // Add all the new nodes
  const { added } = addNodesToVisible(a.nodes, s.selectedNode, s.settings.maxNodes)
  if (added.length > 0) {
    updated = true
  }

  azzert()
  return updated
    ? {
      ...s,
      nodeDataHash: a.nodes.map((n) => n.id).join(',') + '-load',
    }
    : s
}

export type ASetLRUOrder = {
  type: 'SetLRUOrder'
  nodes: GraphNodes['id'][]
}

routes['SetLRUOrder'] = (s: GraphState, a: ASetLRUOrder) => {
  for (const nodeId of a.nodes) {
    visibleNodes.get(nodeId)
  }
  return s
}

export type AGraphBulkUpdated = {
  type: 'GraphBulkUpdate'
  rels: Relations[]
  refs: GraphNodes['id'][]
  loaded: FullNodes[]
}

routes['GraphBulkUpdate'] = (s: GraphState, a: AGraphBulkUpdated) => {
  // Apply updates in order of least state changes
  // Rels come first so that temp islands don't get removed
  const rels =
    routes['RelsLoad'](s, {
      type: 'RelsLoad',
      rels: a.rels,
    })
  azzert()
  const loaded =
    routes['NodesLoad'](rels, {
      type: 'NodesLoad',
      nodes: a.loaded,
    })
  azzert()
  const reffed =
    routes['NodesRef'](loaded, {
      type: 'NodesRef',
      nodeIds: a.refs,
    })
  azzert()
  return reffed
}

export type ANodesReffed = {
  type: 'NodesRef'
  nodeIds: GraphNodes['id'][]
}

routes['NodesRef'] = (s: GraphState, a: ANodesReffed) => {
  if (a.nodeIds.length === 0) {
    return s
  }
  const nodesToAdd = a.nodeIds
    .map((id) => ({ id })) as GraphNodes[]
  const { added } = addNodesToVisible(nodesToAdd, s.selectedNode, s.settings.maxNodes)

  //azzert()
  const ret = added.length > 0
    ? ({
      ...s,
      nodeDataHash: a.nodeIds.join(',') + '-ref',
    } as GraphState)
    : s
  return ret
}

function toLinkView(rel: Relations): LinkView {
  let [srcId, targetId] = getSourceDestFromRel(rel['id'])
  //const [source, target] = [staticState.peekGraphNode(srcId), staticState.peekGraphNode(targetId)] as GraphNodes[]
  //ensure(`Source / target not see in toLinkTarget? ${source ? targetId : srcId}`, !!source && !!target)
  let ratio = 0.8

  return {
    id: rel.id,
    r: ratio,
    source: srcId,
    target: targetId,
  } as LinkView
}

export type ARelsLoaded = {
  type: 'RelsLoad'
  rels: Relations[]
}

function dedupeRels(newRels: Relations[], existing: { id: Relations['id'] }[]): Record<string, Relations> {
  const newRelsMap: Record<string, Relations> = {}
  for (const rel of newRels) {
    newRelsMap[rel.id] = rel
  }
  let dupeCount = 0
  for (const visLink of existing) {
    delete newRelsMap[visLink.id]
    dupeCount++
  }
  if (dupeCount > 0) {
    debug(`${dupeCount} duplicate rels`)
  }
  return newRelsMap
}

routes['RelsLoad'] = (s: GraphState, a: ARelsLoaded) => {
  if (a.rels.length === 0) {
    return s
  }
  const relsChanged = addRels(a.rels, s.selectedNode, s.settings.maxNodes) > 0

  azzert()
  if (relsChanged) {
    return {
      ...s,
      nodeDataHash: `${a.rels[a.rels.length - 1].id}-ref`,
      relsDataHash: a.rels[a.rels.length - 1].id + 'load',
    }
  }
  return s;
}

export type ARelsSelected = {
  type: 'RelsSelect'
  rels: Relations['id'][]
}

routes['RelsSelect'] = (s: GraphState, a: ARelsSelected) => {
  return {
    ...s,
    selectedRels: a.rels,
  }
}

export type ANodeSelected<SEL_TYPE extends GraphNodes['id'] | null | undefined> = {
  type: 'NodeSelect'
  nodeId: SEL_TYPE extends undefined ? null : SEL_TYPE,
  prevId: SEL_TYPE extends undefined ? (GraphNodes['id'] | undefined) : SEL_TYPE extends null ? GraphNodes['id'] : undefined
}

routes['NodeSelect'] = (s: GraphState, a: ANodeSelected<undefined | null | GraphNodes['id']>) => {
  if (s.selectedNode === a.nodeId) {
    return s
  }
  if (a.nodeId) {
    // Put selecteds' neighbors second-in-LRU-line
    const vn = visibleNodes.get(a.nodeId) as VisibleNode
    for (const r of visLinksByNode[vn[0].id]) {
      const ids = getSourceDestFromRel(r.id)
      // Freshen the cache
      const notMe = ids.filter((id) => id !== vn[0].id)
      visibleNodes.get(notMe[0])
    }

    // Put selected stuff front-of-LRU-line
    visibleNodes.get(a.nodeId)
  }

  //azzert()
  return {
    ...s,
    timelineCursors: [],
    timelineMark: 0,
    timelineRels: [],
    selectedRels: [],
    selectedNode: a.nodeId,
    popup: {
      ...s.popup,
      openCount: s.popup.openCount + 1,
      minimized: false,
    },
  }
}

export type ACameraInitialized = {
  type: 'CameraInitialize'
}

routes['CameraInitialize'] = (s: GraphState, a: ACameraInitialized) => {
  return {
    ...s,
    camera: {
      initialized: true,
    },
  }
}

export type ANodeNotFound = {
  type: 'NodeNotFound'
  message: string
}

routes['NodeNotFound'] = (s: GraphState, a: ANodeNotFound) => {
  return {
    ...s,
    notification: {
      msg: a.message,
      t: 'error'
    }
  }
}

export type ANetErrorred = {
  type: 'NetError'
  msg: string
}

routes['NetError'] = (s: GraphState, a: ANetErrorred) => {
  return {
    ...s,
    notification: {
      msg: a.msg,
      t: 'error',
    }
  }
}

export type ANodesRendered = {
  type: 'NodesRender'
  nodes: RenderedNode[]
}

routes['NodesRender'] = (s: GraphState, a: ANodesRendered) => {
  for (const n of a.nodes) {
    const existing = visibleNodes.peek(n.id)
    if (!existing) {
      ensure(`Broken assertion: Rendered node ${n.id} doesnt exist in visibleNodes?`)
    }
  }
  return s
}

export type ANodesFrozen = {
  type: 'NodesFrozen'
}

routes['NodesFrozen'] = (s: GraphState, a: ANodesFrozen) => {
  peekRenderedNodes().forEach((curRendered) => {
    if (isRenderedNode(curRendered)) {
      // Freeze position
      curRendered.fx = curRendered.x
      curRendered.fy = curRendered.y
      curRendered.fz = curRendered.z
    }
  })
  return s
}

export type ANodesUnfrozen = {
  type: 'NodesUnfrozen'
}

routes['NodesUnfrozen'] = (s: GraphState, a: ANodesUnfrozen) => {
  peekRenderedNodes().forEach((node) => {
    if (isRenderedNode(node)) {
      delete node.fx
      delete node.fy
      delete node.fz
    }
  })
  return s
}

export type LoadNodeSpec = {
  t: '0'
  nId: GraphNodes['id']
  // Select the node as well as load it
  sel: '0' | '1'
}

export type LoadLatestBlockSpec = {
  t: '1'
  // Block number
  c: string
  // Max number of follow-up nodes to fetch locally
  m: string
}

export type LoadTimelineMarkSpec = {
  t: '3',
  // The selected node to paginate
  n: PaginatedNode['id'],
  // The unix ms timestamp mark to load
  m: string,
  // First page's cursor to consider before mark
  f: GraphCursor,
  // Second page's cursor to consider after mark,
  // undefined means either end of pages or more to load
  s?: GraphCursor,
}

export type SearchSpec = {
  t: '4',
  s: string,
}

// All query specs should be kept as minified as possible
// for EZ serialization in the browser URL bar one day and must be string values!
export type QuerySpec =
  LoadNodeSpec |
  LoadLatestBlockSpec |
  LoadTimelineMarkSpec |
  SearchSpec

export function isQuerySpec(querySpec: any): querySpec is QuerySpec {
  return typeof (querySpec) === 'object' && typeof (querySpec.t) === 'string' && +querySpec.t >= 0 && querySpec.t < 100
}

// No handler, this is only for sagas
export type AQueried<SPEC extends QuerySpec = QuerySpec> = {
  type: 'Queried'
  spec: SPEC
  isExternal?: true
}

// Emitted by Sagas whenever a History API-worthy query is run
export type AHistoricQueryChanged = {
  type: 'HistoricQueryChanged'
  spec: QuerySpec
  isExternal?: true
}

routes['HistoricQueryChanged'] = (s: GraphState, a: AHistoricQueryChanged) => {
  return {
    ...s,
    // The current query regardless of source
    query: a.spec,
    urlQueryStale: !a.isExternal
  }
}

export type AUrlQueryUpdated = {
  type: 'UrlQueryUpdated'
  //urlUpdate: () => void
}

routes['UrlQueryUpdated'] = (s: GraphState, a: AUrlQueryUpdated) => {
  //a.urlUpdate()
  return {
    ...s,
    urlQueryStale: false
  }
}

export type AQueryEnded = {
  type: 'QueryEnded'
}

routes['QueryEnded'] = (s: GraphState, a: AQueryEnded) => {
  return {
    ...s,
    query: null,
  }
}

export type AWindowDimsChanged = {
  type: 'GraphDimsChanged'
  width: number
  height: number
}

routes['GraphDimsChanged'] = (s: GraphState, a: AWindowDimsChanged) => {
  return {
    ...s,
    windowDims: [a.width, a.height] as [number, number],
  }
}

export type ASelectedFocused = {
  type: 'SelectedFocused'
}

routes['SelectedFocused'] = (s: GraphState, a: ASelectedFocused) => {
  return {
    ...s,
  }
}

export type ASelectedShared = {
  type: 'SelectedShared'
}

routes['SelectedShared'] = (s: GraphState, a: ASelectedShared) => {
  return {
    ...s,
  }
}

export type ASelectedClosed = {
  type: 'SelectedClosed'
}

routes['SelectedClosed'] = (s: GraphState, a: ASelectedClosed) => {
  return {
    ...s,
    popup: {
      ...s.popup,
      minimized: true,
    },
  }
}

export type ASelectedOpened = {
  type: 'SelectedOpened'
}

routes['SelectedOpened'] = (s: GraphState, a: ASelectedOpened) => {
  return {
    ...s,
    popup: {
      ...s.popup,
      minimized: false,
      initialized: true,
      openCount: s.popup.openCount + 1,
    },
  }
}

export type ASetAnimate = {
  type: 'SetAnimate'
  animate: boolean
}

routes['SetAnimate'] = (s: GraphState, a: ASetAnimate) => {
  return {
    ...s,
    settings: {
      ...s.settings,
      animate: a.animate,
    },
  }
}

export type ASetAutoFocus = {
  type: 'SetAutoFocus'
  autoFocus: boolean
}

routes['SetAutoFocus'] = (s: GraphState, a: ASetAutoFocus) => {
  return {
    ...s,
    settings: {
      ...s.settings,
      autoFocus: a.autoFocus,
    },
  }
}

export type ASetMaxNodes = {
  type: 'SetMaxNodes'
  maxNodes: number
}

routes['SetMaxNodes'] = (s: GraphState, a: ASetMaxNodes) => {
  // Resize the cache for new setting
  if (visibleNodes.size !== a.maxNodes) {
    const newVisibleNodes = new LRU<GraphNodes['id'], VisibleNode>({
      max: a.maxNodes,
    })

    addrBalanceSum = BigInt(0)
    while (visibleNodes.size > a.maxNodes) {
      visibleNodes.pop()
    }
    visibleNodes.forEach((vn) => {
      newVisibleNodes.set(vn[0].id, vn)
      if (isFullAddress(vn[0])) {
        addrBalanceSum += wei252ToBigInt(vn[0].eth)
      }
    })

    visibleNodes = newVisibleNodes
    visLinksByNode = {}
    visibleLinks = visibleLinks.filter(
      (vl) => {
        const sourceId = getLinkSourceId(vl)
        const targetId = getLinkTargetId(vl)
        const keep = newVisibleNodes.has(sourceId) && newVisibleNodes.has(targetId)
        if (keep) {
          addVisLinkByNode(sourceId, targetId, vl)
        }
        return keep
      }
    )
    azzert()
    return {
      ...s,
      nodeDataHash: `${a.maxNodes}-resized`,
      relsDataHash: `${a.maxNodes}-resized`,
      selectedNode: (s.selectedNode && visibleNodes.has(s.selectedNode)) ? s.selectedNode : null,
      settings: {
        ...s.settings,
        maxNodes: a.maxNodes,
      },
    }
  }
  return s
}

export type ASetViewMode = {
  type: 'SetViewMode'
  viewMode: GraphState['settings']['viewMode']
}

routes['SetViewMode'] = (s: GraphState, a: ASetViewMode) => {
  return {
    ...s,
    settings: {
      ...s.settings,
      viewMode: a.viewMode,
    },
  }
}

export type ATimelineMarkSet = {
  type: 'TimelineMarkSet',
  mark: number,
}

routes['TimelineMarkSet'] = (s: GraphState, a: ATimelineMarkSet) => {
  // Should never happen
  if (!s.selectedNode) {
    return s
  }

  return {
    ...s,
    timelineMark: a.mark
  }
}

export type ATimelineAppended = {
  type: 'TimelineAppended',
  node: PaginatedNode['id'],
  timeline: GraphCursor[],
  isFullyLoaded: boolean,
}

routes['TimelineAppended'] = (s: GraphState, a: ATimelineAppended) => {
  // Received timeline batch after deselection, ignore
  if (s.selectedNode !== a.node) {
    return s
  }

  // Append to the timeline
  const toAppend: TimelineCursor[] = a.timeline.map((cursor) => {
    const cursorDate = parseCursor(cursor).timeMs
    return [cursorDate, cursor]
  })

  const appended = s.timelineCursors.concat(toAppend)
  const datesSeen = new Set<number>()
  const deduped = appended.filter((tl) => {
    const seen = datesSeen.has(tl[0])
    datesSeen.add(tl[0])
    return !seen
  })
  deduped.sort((tl1, tl2) => {
    return tl1[0] < tl2[0] ? -1 : 1
  })
  return {
    ...s,
    timelineCursors: deduped,
    timelineLoaded: a.isFullyLoaded
  }
}

export type ASelectedRelsPageLoaded = {
  type: 'SelectedRelsPageLoaded',
  intendedTimelineMark: number,
  timelineRels: Relations[],
  visibleRels: Relations[],
  nodeId: PaginatedNode['id'],
}

routes['SelectedRelsPageLoaded'] = (s: GraphState, a: ASelectedRelsPageLoaded) => {
  const nodeId = a.nodeId;

  // Page load completed after deselection, ignore
  if (nodeId !== s.selectedNode) {
    return s
  }
  // This page request is stale, throw it away
  if (a.intendedTimelineMark !== s.timelineMark) {
    return s
  }

  const visibleNode = visibleNodes.get(nodeId)
  if (!visibleNode) {
    return s
  }

  // Ensure node state is loaded
  const nodeLoadState = routes['NodesLoad'](s, { type: 'NodesLoad', nodes: [visibleNode[0] as FullNodes] })

  // Special case, very first page loaded,
  // treat like a normal rels loaded action + set initial mark
  if (nodeLoadState.timelineMark === 0) {
    const relsLoadedState = routes['RelsLoad'](nodeLoadState, { type: 'RelsLoad', rels: a.visibleRels })
    return {
      ...relsLoadedState,
      timelineMark: Number(fromRadix252(a.timelineRels[0].ts)),
      timelineRels: a.timelineRels
    }
  }

  // A page the user selected is loaded,
  // swap out the old page for the new by selectively
  // removing single-linked nodes, since they are presumably
  // from the last page only
  const nodeRels = [...visLinksByNode[nodeId]];
  const deletedNeighbors: VisibleNode[] = []
  const keepSet = new Set(a.visibleRels.map((r) => getSourceDestFromRel(r.id)).flat())
  for (const rel of nodeRels) {
    const [source, dest] = getSourceDestFromRel(rel.id)
    const neighborId = source === nodeId ? dest : source
    const neighbor = visibleNodes.get(neighborId)
    if (neighbor && visLinksByNode[neighbor[0].id].length === 1 && !keepSet.has(neighborId)) {
      visibleNodes.delete(neighborId)
      deletedNeighbors.push(neighbor)
    }
  }
  cleanupDeletedNodes(s.selectedNode, deletedNeighbors, true)

  // Old page is wiped, now add the new page
  // by re-using RelsLoad
  const pageLoaded = routes['RelsLoad'](nodeLoadState, { type: 'RelsLoad', rels: a.visibleRels })
  azzert()
  return {
    ...pageLoaded,
    timelineRels: a.timelineRels,
  }
}

export type ASearchLoading = {
  type: 'SearchLoading'
}

routes['SearchLoading'] = (s: GraphState, a: ASearchLoading) => {
  return {
    ...s,
    searchLoading: true
  }
}

export type ASearchLoaded = {
  type: 'SearchLoaded'
}

routes['SearchLoaded'] = (s: GraphState, a: ASearchLoaded) => {
  return {
    ...s,
    searchLoading: false
  }
}

export type ASetVrEnabled = {
  type: 'SetVrEnabled'
  vrEnabled: GraphState['settings']['vrEnabled']
}

function addVisLinkByNode(sourceId: GraphNodes['id'], targetId: GraphNodes['id'], link: LinkView): void {
  if (visLinksByNode[sourceId] === undefined) {
    visLinksByNode[sourceId] = []
  }
  visLinksByNode[sourceId].push(link)
  if (visLinksByNode[targetId] === undefined) {
    visLinksByNode[targetId] = []
  }
  visLinksByNode[targetId].push(link)
}

routes['SetVrEnabled'] = (s: GraphState, a: ASetVrEnabled) => {
  if (s.settings.vrEnabled === a.vrEnabled) {
    return s
  }
  // Invalidate all rendered objects!
  visibleNodes.forEach((vn) => {
    vn[3] = true
  })
  visLinksByNode = {}
  visibleLinks.forEach((vl, i) => {
    try {
      const sourceId = getLinkSourceId(vl)
      const targetId = getLinkTargetId(vl)
      visibleLinks[i] = {
        id: vl.id,
        source: sourceId,
        target: targetId,
        r: 0.5
      }
      addVisLinkByNode(sourceId, targetId, visibleLinks[i])
    } catch (e) {
      throw e
    }
  })
  return {
    ...s,
    settings: {
      ...s.settings,
      vrEnabled: a.vrEnabled
    },
  }
}

export type ASetLatestNotification = {
  type: 'SetLatestNotification'
  msg: string,
  t: NotifyType,
}

routes['SetLatestNotification'] = (s: GraphState, a: ASetLatestNotification) => {
  if (s.notification.msg === a.msg && s.notification.t === a.t) {
    return s
  }
  return {
    ...s,
    notification: {
      msg: a.msg,
      t: a.t,
    }
  }
}

const getInitWindowDims = () => {
  return [window.outerWidth, window.outerHeight] as [number, number]
}

export type GraphActions =
  | ACameraInitialized
  | ANetErrorred
  | ANodesFrozen
  | ANodesUnfrozen
  | ANodesLoaded
  | ANodesReffed
  | AGraphBulkUpdated
  | ANodeSelected<null> | ANodeSelected<GraphNodes['id']>
  | ANodesRendered
  | ANodeNotFound
  | ARelsLoaded
  | ARelsSelected
  | AQueried
  | AQueryEnded
  | AWindowDimsChanged
  | ASelectedFocused
  | ASelectedShared
  | ASelectedClosed
  | ASelectedOpened
  | ASetAnimate
  | ASetAutoFocus
  | ASetMaxNodes
  | ASetViewMode
  | ASetLRUOrder
  | ASetVrEnabled
  | ATimelineMarkSet
  | ATimelineAppended
  | ASelectedRelsPageLoaded
  | ASearchLoading
  | ASearchLoaded
  | ASetLatestNotification
  | AHistoricQueryChanged
  | AUrlQueryUpdated

// A barebones shell of pointer that obeys normal Reducer paradigms,
// however a ton of cached static state backs this to make it fast
export const graphReducer: Reducer<GraphState, GraphActions> = (
  state: GraphState = initialState,
  action: GraphActions
): GraphState => {
  const reducer = routes[action.type]
  if (!reducer) {
    return state
  }
  //@ts-ignore
  return reducer(state, action)
}

export type ActionDispatch = (a: GraphActions) => void
export type ActionDispatchGenerator = AsyncGenerator<
  undefined,
  undefined,
  [ActionDispatch, GraphState]
>

export const initialState = {
  notification: {
    msg: '',
    t: '',
  },

  relsDataHash: '',
  nodeDataHash: '',

  selectedNode: null,
  timelineCursors: [],
  timelineLoaded: false,
  timelineMark: 0,
  timelineRels: [],
  selectedRels: [],

  camera: { initialized: false },
  query: null,
  urlQueryStale: false,
  lastGlobalQuery: null,
  windowDims: getInitWindowDims(),

  popup: {
    initialized: false,
    minimized: false,
    shareMode: false,
    openCount: 0,
  },

  settings: {
    autoFocus: true,
    maxNodes: DEFAULT_VISIBLE_NODES,
    animate: true,
    viewMode: 'graph',
    lastLiveBlock: null,
    vrEnabled: false,
  },

  searchLoading: false,
} as GraphState

export type NotifyType = '' | 'warning' | 'info' | 'error' | 'success'
export type Notification = { msg: string, t: NotifyType }
export type TimelineCursor = [number, GraphCursor]
export type GraphState = Readonly<{
  notification: Notification,

  nodeDataHash: string // A hash that changes whenever graph node data changes
  relsDataHash: string // A hash that changes whenever graph rel data changes

  selectedNode: GraphNodes['id'] | null
  timelineCursors: TimelineCursor[]
  timelineLoaded: boolean
  timelineMark: number
  timelineRels: Relations[]
  selectedRels: Relations['id'][]

  camera: {
    initialized: boolean
  }
  query: QuerySpec | null
  urlQueryStale: boolean
  windowDims: [number, number]

  // Popup state
  popup: {
    minimized: boolean
    shareMode: boolean
    openCount: number
  },

  searchLoading: boolean,

  settings: {
    autoFocus: boolean
    maxNodes: number
    animate: boolean
    viewMode: 'chain' | 'graph'
    lastLiveBlock: number | null
    vrEnabled: boolean
  },
}>
