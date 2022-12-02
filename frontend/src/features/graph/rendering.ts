import * as THREE from 'three'
import {
  Address,
  Block, CHILD_TRANSACTION, FullAddress, getGraphType, getObjId, getSourceDestFromRel, GraphNodes, isAddress, isAddressId, isBlock, isBlockId,
  isFullAddress,
  isFullBlock,
  isFullNode,
  isFullTransaction, isTransaction, isTransactionId, MINER, parseBlockNumber, Relations, TRANSACTION_TYPE
} from './global/types'

import { SpriteMaterial } from 'three'
//import contractImg from '../../assets/contract.png'
import dollarGrayImg from '../../assets/dollar-gray.png'
import dollarImg from '../../assets/dollar.png'
import ethBrainImg from '../../assets/eth-brain.png'
import eth1Img from '../../assets/ethereum-1.png'
import eth2Img from '../../assets/ethereum-2.png'
import eth3Img from '../../assets/ethereum-3.png'
import eth4Img from '../../assets/ethereum-4.png'
import ethGrayImg from '../../assets/ethereum-gray.png'
import ethImg from '../../assets/ethereum.png'
import minerImg from '../../assets/miner.png'
import whaleImg from '../../assets/whale.png'
import { isContract, isWhale } from './global/biz-types'
import { RELATION_PAGE_SIZE } from './global/tuning'
import {
  assertUnreachable, densure, instrumentDebug, radix252ToDecimal, wei252ToBigInt, weiToEth
} from './global/utils'
import { Point3d } from './Graph'
import { GraphState, staticState } from './graph-reducer'

export const TIME_TILL_FREEZE = 3000
const ethImgs = [ethImg, eth1Img, eth2Img, eth3Img, eth4Img]

let globalFreezeTimeout: ReturnType<typeof setTimeout> = setTimeout(() => { }, 0)

// A node that has THREE.js metadata attached to it, might
// also be a DataNode
export type RenderedNode = GraphNodes & {
  x: number
  y: number
  z: number
  // Timestamp of when this first became visible
  visTs?: number
  fx?: number
  fy?: number
  fz?: number
  __threeObj?: any
}

type DataLinkView = {
  id: Relations['id']
  // Ratio from 0 to 1 of relation weight
  r: number
  source: GraphNodes['id']
  target: GraphNodes['id']
}

export type RenderedLinkView = Omit<Omit<DataLinkView, 'source'>, 'target'> & {
  source: RenderedNode
  target: RenderedNode
}
export type LinkView = DataLinkView | RenderedLinkView
export type GraphView = {
  nodes: RenderedNode[]
  links: LinkView[]
}

export function getHumanName(node: GraphNodes['id']): string {
  if (isAddressId(node)) {
    return 'address'
  } else if (isBlockId(node)) {
    return 'block'
  } else if (isTransactionId(node)) {
    return 'transaction'
  }
  assertUnreachable(node)
}

export function isLink(link: any): link is LinkView {
  return typeof link === 'object' && 'source' in link
}

export function isRenderedLink(link: any): link is RenderedLinkView {
  return isLink(link) && isRenderedNode(link.source) && isRenderedNode(link.target)
}

export function isRenderedNode(node: any): node is RenderedNode {
  return /*kinda sloowwwww isGraphNode(node) &&*/ typeof (node) === 'object' && 'x' in node
}

const debug = instrumentDebug('rendering')

export const unfreezeAll = () => {
  const nodes = staticState.peekRenderedNodes()
  nodes.forEach((node) => {
    if (isRenderedNode(node)) {
      delete node.fx
      delete node.fy
      delete node.fz
      delete node.visTs
    }
  })
  checkForFreezingNodes(nodes)
}

function moveNodeTo(
  asRendered: RenderedNode,
  pos: { x: number; y: number; z: number }
): void {
  asRendered.x = pos.x
  asRendered.y = pos.y
  asRendered.z = pos.z
}

function freezeNodeAt(
  asRendered: RenderedNode,
  pos: { x: number; y: number; z: number }
): void {
  //asRendered.x = pos.x
  //asRendered.y = pos.y
  //asRendered.z = pos.z
  asRendered.fx = pos.x
  asRendered.fy = pos.y
  asRendered.fz = pos.z
  debug(`Freezing ${asRendered.id}`)
}

// Map a linear distance to a path along a spiral in 3D
const LINE_DIST_PER_SPIRAL = 50
const SPIRAL_RADIUS = 50

export const BLOCK_NODE_DISTANCE = 100

function lineToSpiral(lineDistance: number, origin: Point3d): Point3d {
  const z = lineDistance // / LINE_DIST_PER_SPIRAL
  //const theta = relativeBn % LINE_DIST_PER_SPIRAL
  return {
    x: 0 + origin.x,
    y: 0 + origin.y, //...polarToXY(theta, SPIRAL_RADIUS),
    z: z + origin.z,
  }
}

function polarToXY(theta: number, len: number): { x: number; y: number } {
  return {
    x: len * Math.cos(theta),
    y: len * Math.sin(theta),
  }
}

function freshBlockShuffle(sortedBlockNodes: (Block & RenderedNode)[], origin: Point3d) {
  // Track point on the z axis we're currently at, progress down it while adding ordered blocks
  let curDistOnLine = 0
  for (let i = 0; i < sortedBlockNodes.length; i++) {
    const block = sortedBlockNodes[i]
    const curPoint = lineToSpiral(curDistOnLine, origin)
    freezeNodeAt(block, curPoint)
    // Examine the next block, if it's sequential, inc by block dist
    if (i + 1 < sortedBlockNodes.length) {
      const curBlockNumber = parseBlockNumber(block.id)
      const nextBlockNumber = parseBlockNumber(sortedBlockNodes[i + 1].id)
      if (curBlockNumber + 1 === nextBlockNumber) {
        curDistOnLine += BLOCK_NODE_DISTANCE
      } else {
        // If non-sequential, place 2.1x distance away to represent the gap
        // and leave space for 1 more future non-disruptive block insert
        curDistOnLine += BLOCK_NODE_DISTANCE * 2.2
      }
    }
  }
}

// A tiny piece of 1-time state to set the origin.  Normally the (0,0,0) origin is fine to start
// building a block chain on, except for when a non-block was already added!  Adjust for that with this:
let originPoint: Point3d | null = null

// Pin any unfrozen block nodes across the Z axis
function arrangeBlocks(nodes: RenderedNode[]) {
  const allBlocks = nodes.filter((n) => isBlock(n)) as (Block & RenderedNode)[]

  if (allBlocks.length === 0) {
    return
  }

  originPoint = originPoint || calculateCenterOfMass(nodes)

  allBlocks.sort((a, b) => parseBlockNumber(a.id) - parseBlockNumber(b.id))
  const pinnedBlocks = allBlocks.filter((n) => 'fz' in n)
  const unpinnedBlocks = allBlocks.filter((n) => !('fz' in n))

  if (/*pinnedBlocks.length === 0 &&*/ pinnedBlocks.length === 0) {
    freshBlockShuffle(unpinnedBlocks, originPoint)
    return
  }
  for (const unpinned of unpinnedBlocks) {
    const firstPinned = parseBlockNumber(pinnedBlocks[0].id)
    const lastPinned = parseBlockNumber(pinnedBlocks[pinnedBlocks.length - 1].id)
    const asRendered = unpinned as RenderedNode & Block
    // Easy cases
    const unpinnedNum = parseBlockNumber(unpinned.id)
    if (unpinnedNum < firstPinned) {
      const baseZ = pinnedBlocks[0].z
      const offsetZ = BLOCK_NODE_DISTANCE * (unpinnedNum + 1 === firstPinned ? 1 : 2.2)
      freezeNodeAt(asRendered, lineToSpiral(baseZ - offsetZ, originPoint))
      pinnedBlocks.splice(0, 0, asRendered)
    } else if (unpinnedNum > lastPinned) {
      const baseZ = pinnedBlocks[pinnedBlocks.length - 1].z
      const offsetZ = BLOCK_NODE_DISTANCE * (unpinnedNum - 1 === lastPinned ? 1 : 2.2)
      freezeNodeAt(asRendered, lineToSpiral(baseZ + offsetZ, originPoint))
      pinnedBlocks.splice(pinnedBlocks.length, 0, asRendered)
    }
    // Need to sloppily insert the block between existing blocks
    else {
      let insertionIndex = 1
      for (; insertionIndex < pinnedBlocks.length; insertionIndex++) {
        const blockINumber = parseBlockNumber(pinnedBlocks[insertionIndex].id)
        const iMinus1Number = parseBlockNumber(pinnedBlocks[insertionIndex - 1].id)

        if (iMinus1Number < unpinnedNum && unpinnedNum < blockINumber) {
          const block = pinnedBlocks[insertionIndex]
          const lastBlock = pinnedBlocks[insertionIndex - 1]
          const midpointZ = (block.z + lastBlock.z!) / 2.0

          // If the insert is cutting it too close, perform a whole block reshuffle
          /*if (block.z - midpointZ < BLOCK_NODE_DISTANCE) {
            // On a fresh block shuffle, all nodes have to be freed up to let them settle on the new
            // fixed block locations!
            unfreezeAll()
            freshBlockShuffle(allBlocks)
            return
          }*/

          // Shove the block safely inbetween it's 2 neighbors
          freezeNodeAt(asRendered, lineToSpiral(midpointZ, originPoint))
          pinnedBlocks.splice(insertionIndex, 0, asRendered)
          break
        }
      }
    }
  }
}

// Ensure all non-blocks get frozen if time's up or at least tagged for it
// Also initialize their position if not yet set
function arrangeNonBlocks(nodes: RenderedNode[], selectedNodeId: GraphNodes['id'] | null) {
  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null
  for (const node of nodes) {
    if (!node.visTs) {
      if (isTransaction(node)) {
        // Find parent block and set to it's position
        // if found
        const tRels = staticState.peekNodeRelations(node.id)
        const childRel = tRels ? (tRels.find((rel) => getGraphType(rel.id) === CHILD_TRANSACTION)) : false
        if (childRel) {
          const relIds = getSourceDestFromRel(childRel.id)
          const blockId = relIds[0]
          const block = staticState.peekRenderedNode(blockId)
          if (block) {
            moveNodeTo(node, getRandomPointOrbitting(block, BLOCK_NODE_DISTANCE / 2))
            continue;
          }
        }
      }

      if (selectedNode && selectedNodeId !== node.id) {
        moveNodeTo(node, getRandomOrbittingPointFurthestFromMass(nodes, selectedNode, BLOCK_NODE_DISTANCE))
      }
      else {
        const rels = staticState.peekNodeRelations(node.id)
        const relNodes = (rels || []).map((rel) => {
          const srcDest = getSourceDestFromRel(rel.id)
          const otherId = srcDest.find((n) => n !== node.id)![0] as GraphNodes['id']
          return staticState.peekRenderedNode(otherId)
        }).filter((n) => !!n) as RenderedNode[]

        // Place new random object at the average of all it's known neighbors, or center of mass if none
        if (relNodes.length === 0) {
          moveNodeTo(node, getRandomPointNearCenter(nodes, BLOCK_NODE_DISTANCE * 5))
        } else {
          moveNodeTo(node, getRandomOrbittingPointFurthestFromMass(nodes, calculateCenterOfMass(relNodes), BLOCK_NODE_DISTANCE / 2))
        }
      }
    }
  }

  const hotCount = checkForFreezingNodes(nodes)
  if (hotCount > 0) {
    clearTimeout(globalFreezeTimeout)
    globalFreezeTimeout = setTimeout(() => checkForFreezingNodes(nodes), TIME_TILL_FREEZE + 1)
  }
}

function checkForFreezingNodes(nodes: RenderedNode[]) {
  const unpinnedBlocks = staticState
    .peekRenderedNodes()
    .filter((n) => !('fz' in n)) as RenderedNode[]
  const freezeDeadline = new Date().getTime() - TIME_TILL_FREEZE
  let hotCount = 0
  unpinnedBlocks.forEach((unpinned) => {
    if (!unpinned.visTs) {
      unpinned.visTs = new Date().getTime()
      hotCount++
    } else if (unpinned.visTs < freezeDeadline) {
      freezeNodeAt(unpinned, unpinned)
    } else {
      hotCount++
    }
  })

  return hotCount
}

const calcWorldBox = (nodes: RenderedNode[]): [Point3d, Point3d] => {
  const maxs = { x: -(Number.MAX_SAFE_INTEGER / 2), y: -(Number.MAX_SAFE_INTEGER / 2), z: -(Number.MAX_SAFE_INTEGER / 2) }
  const mins = { x: Number.MAX_SAFE_INTEGER / 2, y: Number.MAX_SAFE_INTEGER / 2, z: Number.MAX_SAFE_INTEGER / 2 }

  for (const node of nodes) {
    maxs.x = Number.isFinite(node.x) ? Math.max(maxs.x, node.x) : maxs.x
    maxs.y = Number.isFinite(node.y) ? Math.max(maxs.y, node.y) : maxs.y
    maxs.z = Number.isFinite(node.z) ? Math.max(maxs.z, node.z) : maxs.z
    mins.x = Number.isFinite(node.x) ? Math.min(mins.x, node.x) : mins.x
    mins.y = Number.isFinite(node.y) ? Math.min(mins.y, node.y) : mins.y
    mins.z = Number.isFinite(node.z) ? Math.min(mins.z, node.z) : mins.z
  }
  return [mins, maxs]
}

const calculateCenterOfMass = (nodes: RenderedNode[]): Point3d => {
  const sums = { x: 0, y: 0, z: 0 }
  const counts = { x: 0, y: 0, z: 0 }
  for (const node of nodes) {
    sums.x += node.x || 0
    sums.y += node.y || 0
    sums.z += node.z || 0
    counts.x += node.x ? 1 : 0
    counts.y += node.y ? 1 : 0
    counts.z += node.z ? 1 : 0
  }
  return {
    x: sums.x / Math.max(1, counts.x),
    y: sums.y / Math.max(1, counts.y),
    z: sums.z / Math.max(1, counts.z),
  }
}

const getRandomPointNearby = (point: Point3d, maxDistance: number): Point3d => {
  return {
    x: point.x + Math.random() * maxDistance,
    y: point.y + Math.random() * maxDistance,
    z: point.z + Math.random() * maxDistance,
  }
}

const getRandomPointOrbitting = (point: Point3d, distance: number): Point3d => {
  const random = Math.random()
  const randomCoord = random < 1 / 3 ? 'x' : ((random < 2 / 3) ? 'y' : 'z')
  const randomCoord2 = random < 1 / 3 ? 'y' : ((random < 2 / 3) ? 'z' : 'x')
  const randomCoord3 = (['x', 'y', 'z'] as const).filter((c) => c !== randomCoord && c !== randomCoord2)![0]

  const centerDistScalar = Math.random() * 2 - 1
  // Pick a random z plane
  const r1 = point[randomCoord] + centerDistScalar * distance
  // Figure out the resulting freedom for x/y by approximating the remaining circle radius and degrees of freedom
  const radius2d = distance * (1 - Math.abs(centerDistScalar)) + 0.0001
  // Pick a random X contained in the remaining circle's degrees of freedom
  const r2 = point[randomCoord2] + ((Math.random() * 2 - 1) * radius2d)

  // Solve for 1/2 random possible Y's given rx, rz and r
  // (x-a)^2 + (y-b)^2 = r^2
  // y = sqrt(r^2 - (x-a)^2) + b
  const r3 = Math.sqrt(radius2d * radius2d - Math.pow(r2 - point[randomCoord2], 2)) * (Math.random() < 0.5 ? -1 : 1) + point[randomCoord3]

  return { [randomCoord2]: r2, [randomCoord3]: r3, [randomCoord]: r1 } as Point3d

  /*
  // Now solve for the unknown coordinate based on sphere equation
  // x  = sqrt( -((y - y0)^2 + (z - z0)^2 - r^2) ) + x0
  const randomVal1 = point[randomCoord] + distance * (Math.random() > 0.5 ? 1 : -1)
  const randomVal2 = point[randomCoord2] + distance * (Math.random() > 0.5 ? 1 : -1)
  const unknownVal = Math.sqrt(-((randomVal1 - point[randomCoord]) ^ 2 + (randomVal2 - point[randomCoord2]) ^ 2 - Math.pow(distance, 2))) + point[unknownCoord]

  return {
    [randomCoord]: randomVal1,
    [randomCoord2]: randomVal2,
    [unknownCoord]: unknownVal,
  } as Point3d
  */
}

const getRandomOrbittingPointFurthestFromMass = (nodes: RenderedNode[], point: Point3d, distance: number): Point3d => {
  // Potentially reflect the point about the distance sphere centered on point across said point if
  // it makes it further from center mass
  const p1 = getRandomPointOrbitting(point, distance)
  // TODO fix this and remove true ||
  if (nodes.length < RELATION_PAGE_SIZE) {
    return p1
  }

  const lineLen = Math.sqrt(Math.pow(p1.x - point.x, 2) + Math.pow(p1.y - point.y, 2) + Math.pow(p1.z - point.z, 2))
  const newLineLen = lineLen * 2
  const p1Reflected = {
    x: (p1.x - point.x) * (newLineLen / lineLen) + point.x,
    y: (p1.y - point.y) * (newLineLen / lineLen) + point.y,
    z: (p1.z - point.z) * (newLineLen / lineLen) + point.z
  }

  const centerMass = calculateCenterOfMass(nodes)
  const orbitDistToCenter = Math.sqrt(Math.pow(p1.x - centerMass.x, 2) + Math.pow(p1.y - centerMass.y, 2) + Math.pow(p1.z - centerMass.z, 2))
  const reflectedDistToCenter = Math.sqrt(Math.pow(p1Reflected.x - centerMass.x, 2) + Math.pow(p1Reflected.y - centerMass.y, 2) + Math.pow(p1Reflected.z - centerMass.z, 2))

  if (orbitDistToCenter > reflectedDistToCenter) {
    return p1
  }
  return p1Reflected
}

const getRandomPointNearCenter = (nodes: RenderedNode[], maxDistance: number): Point3d => {
  return getRandomPointNearby(calculateCenterOfMass(nodes), maxDistance)
}

export const toGraphViewNodes = (viewMode: GraphState['settings']['viewMode'], selectedNodeId: GraphNodes['id'] | null) => {
  debug(`Paint Graph Nodes ${viewMode.length}`)
  const nodes: RenderedNode[] = staticState.peekRenderedNodes()
  if (viewMode === 'chain') {
    arrangeBlocks(nodes)
  }
  arrangeNonBlocks(nodes, selectedNodeId)
  return nodes
}

export function getLinkId(link: LinkView) {
  const nodeIds = [getLinkSourceId(link), getLinkTargetId(link)]
  return nodeIds.join(',')
}

export function getLinkSourceId(link: LinkView) {
  return isRenderedLink(link) ? link.source.id : link.source
}

export function getLinkTargetId(link: LinkView) {
  return isRenderedLink(link) ? link.target.id : link.target
}

export function getLinkWidth(link: RenderedLinkView) {
  return link.r
}

const BLOCK_X_LEN = 23
const BLOCK_Y_LEN = 4
const BLOCK_Z_LEN = 14

const box = new THREE.BoxGeometry(BLOCK_X_LEN, BLOCK_Y_LEN, BLOCK_Z_LEN)
const loadedBlockSkin = new THREE.MeshPhysicalMaterial({
  color: 0xffe700,
  emissive: 0x000000,
  metalness: 0.25,
  flatShading: false,
  roughness: 0.1,
  //envMap: textureCube,
  reflectivity: 1,
  opacity: 0.85,
  transparent: true,
  transmission: 0.09,
  clearcoat: 1.0,
  clearcoatRoughness: 0.25
})
const loadedBlockModel = new THREE.Mesh(box, loadedBlockSkin)

const loadingBlockSkin = new THREE.MeshPhysicalMaterial({
  color: 0xffe700,
  emissive: 0x000000,
  metalness: 0.3,
  flatShading: false,
  roughness: 0.1,
  //envMap: textureCube,
  reflectivity: 1,
  opacity: 0.4,
  transparent: true,
  transmission: 0.09,
  //clearcoat: 1.0,
  //clearcoatRoughness: 0.25
})
const loadingBlockModel = new THREE.Mesh(box, loadingBlockSkin)

function generateEthBlock(isLoaded: boolean) {
  return isLoaded ? loadedBlockModel.clone(false) : loadingBlockModel.clone(false)
}

const contractMaterial = generateImgMaterial(dollarGrayImg)//contractImg)
contractMaterial.opacity = 0.85

const loadingDollarMaterial = generateImgMaterial(dollarGrayImg)
loadingDollarMaterial.opacity = 0.4
const loadedDollarMaterial = generateImgMaterial(dollarImg)
loadedDollarMaterial.opacity = 0.85

const loadingEthBrainMaterial = generateImgMaterial(ethBrainImg)
loadingEthBrainMaterial.opacity = 0.4
const loadedEthBrainMaterial = generateImgMaterial(ethBrainImg)
loadedEthBrainMaterial.opacity = 0.85

const whaleMaterial = generateImgMaterial(whaleImg)
whaleMaterial.opacity = 0.85

const minerMaterial = generateImgMaterial(minerImg)
minerMaterial.opacity = 0.85

function generateTransaction(isLoaded: boolean) {
  return isLoaded ? loadedEthBrainMaterial : loadingEthBrainMaterial//loadedDollarMaterial : loadingDollarMaterial
}

const loadedEthMaterial = ethImgs.map((e) => generateImgMaterial(e))
for (const e of loadedEthMaterial) {
  e.opacity = 0.85
}
const loadingEthMaterial = generateImgMaterial(ethGrayImg)
loadingEthMaterial.opacity = 0.4

function generateImgMaterial(img: string) {
  const imgTexture = new THREE.TextureLoader().load(img)
  const material = new THREE.SpriteMaterial({ map: imgTexture })
  return material
}

function getEthSkin(id: Address['id']) {
  const objId = getObjId(id)
  const hashedIndex = (+radix252ToDecimal(objId)) % loadedEthMaterial.length
  console.log("hash is " + hashedIndex + ' of ' + loadedEthMaterial.length)
  return loadedEthMaterial[hashedIndex]
}

function generateImgNode(
  material: SpriteMaterial,
  scalar: number,
  xScalar: number,
  yScalar: number,
) {
  // TODO: clone?
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(xScalar * scalar, yScalar * scalar, 0.1)
  return sprite
}

export function createThreeObj(node: RenderedNode): THREE.Object3D {
  return staticState.peekThreeObjOrSet(node.id, () => createThreeObjFresh(node))
}

//const MIN_AVG_ETH_FOR_SCALE = 0.001
//const MAX_AVG_ETH_FOR_SCALE = 500.0
const MAX_PHYSICAL_SCALAR = 8
const DEFAULT_SCALAR = MAX_PHYSICAL_SCALAR / 3.0

function generateSphere(scalar: number, color: string, opacity: number) {
  const sphere = new THREE.SphereGeometry(2.5 * scalar)
  const skin = new THREE.MeshLambertMaterial({
    color,
    transparent: true,
    opacity: opacity,
  })
  return new THREE.Mesh(sphere, skin)
}

function calculateScale(rNode: RenderedNode): number {
  const node = rNode as GraphNodes
  // Address scale is relative to global avg eth
  if (isFullNode(node)) {
    if (isFullTransaction(node) || isFullAddress(node)) {
      const MIN_ETH_FOR_SCALE = 0.5
      const MAX_ETH_FOR_SCALE = 10

      const predicate = isFullAddress(node) ? isFullAddress : isFullTransaction
      const nodes = staticState.peekRenderedNodes().filter((rn) => predicate(rn)) as (RenderedNode & { eth: string })[]
      const ethSum = nodes.reduce((sum, n) =>
        sum + Math.min(MIN_ETH_FOR_SCALE, Math.max(+weiToEth(wei252ToBigInt(n.eth)), MAX_ETH_FOR_SCALE)),
        0)

      const avgEth = Number(ethSum) / nodes.length
      const nodeEth = +weiToEth(wei252ToBigInt(node.eth))
      return Math.max(1, Math.min(MAX_PHYSICAL_SCALAR, nodeEth / avgEth))
    }
    else if (isFullBlock(node)) {
      // Peek at immediate transactions and sum eth amounts
      const links = staticState.peekNodeRelations(node.id) || []
      let transCount = 0

      for (const link of links) {
        if (link.id.startsWith(TRANSACTION_TYPE)) {
          transCount++
        }
      }

      // Scale the block size up to max of X transactions
      const MAX_TRANS_COUNT_BOOST = 50
      const blockSize = Math.min(MAX_TRANS_COUNT_BOOST, transCount)
      const rawScalar = blockSize / MAX_TRANS_COUNT_BOOST

      // Scale from 1x up to half of MAX_PHYSICAL_SCALAR
      return Math.max(1 / MAX_PHYSICAL_SCALAR, Math.min(rawScalar, 0.5)) * MAX_PHYSICAL_SCALAR
    }
  }
  else {
    if (isTransaction(node) || isAddress(node) || isBlock(node)) {
      return DEFAULT_SCALAR
    }
  }

  assertUnreachable(node)
}

function create3dNode(node: RenderedNode): THREE.Object3D {
  console.log('hash ' + JSON.stringify('create ' + node.id, null, 2));
  const scalar = calculateScale(node)
  densure("Scalar too small?", scalar >= 1)
  // Base case, node is not yet loaded, display partially
  if (!node || !isFullNode(node)) {
    console.log('hash not full node ' + node.id)
    if (isBlockId(node.id)) {
      return generateEthBlock(false)
    } else if (isTransactionId(node.id)) {
      return generateImgNode(loadingDollarMaterial, scalar, 5, 6)
    } else if (isAddressId(node.id)) {
      return generateImgNode(loadingEthMaterial, scalar, 5, 8)
    } else {
      assertUnreachable(node.id)
    }
  }

  // Fully loaded types
  else if (isFullAddress(node)) {
    if (isContract(node)) {
      console.log('hash gen full cont ' + node.id + ' ' + JSON.stringify(scalar, null, 2));
      return generateImgNode(contractMaterial, scalar, 5, 6)
    }
    if (isWhale(node)) {
      console.log('hash gen full whale ' + node.id + JSON.stringify('', null, 2));
      return generateImgNode(whaleMaterial, scalar, 10, 6)
    }
    if (isMiner(node)) {
      console.log('hash gen full miner ' + node.id + JSON.stringify('', null, 2));
      return generateImgNode(minerMaterial, scalar, 6, 6)
    }
    console.log('hash gen full addr ' + node.id + JSON.stringify('', null, 2));
    return generateImgNode(getEthSkin(node.id), scalar, 5, 8)
  } else if (isFullBlock(node)) {
    return generateEthBlock(true)
  } else if (isFullTransaction(node)) {
    const x = generateImgNode(loadedDollarMaterial, scalar, 5, 6)
    return x
  }

  assertUnreachable(node)
}

function createThreeObjFresh(node: RenderedNode): THREE.Object3D {
  debug(`Rendering THREE ${node.id}`)
  const newObj = create3dNode(node)
  return newObj
}

function isMiner(node: FullAddress): boolean {
  const rels = staticState.peekNodeRelations(node.id)
  return Array.isArray(rels) && rels.some((r) => getGraphType(r.id) === MINER)
}

const coldBlue = [0x78, 0xa3, 0xff]
const white = [0xff, 0xff, 0xff]
const hotRed = [0xff, 0x31, 0x31]
const diffBlue = [white[0] - coldBlue[0], white[1] - coldBlue[1], white[2] - coldBlue[2]]
const diffRed = [hotRed[0] - white[0], hotRed[1] - white[1], hotRed[2] - white[2]]
export function getLinkColor(link: LinkView): string {
  const ratio = link.r
  const coolest = ratio > 0.5 ? white : coldBlue
  const hottest = ratio > 0.5 ? hotRed : white
  const diff = ratio > 0.5 ? diffRed : diffBlue
  const adjustedRatio = ratio > 0.5 ? ratio / 0.5 : ratio * 2
  const mixed = [
    coolest[0] + Math.round(adjustedRatio * diff[0]),
    coolest[1] + Math.round(adjustedRatio * diff[1]),
    coolest[2] + Math.round(adjustedRatio * diff[2]),
  ]
  //return new THREE.Color(`#${mixed[0].toString(16) + mixed[1].toString(16) + mixed[2].toString(16)}`)
  const color = `rgb(${mixed[0]},${mixed[1]},${mixed[2]})`
  //debug(color)
  return `rgb(255,255,255)`
  //return color;
}
