import {
  assertUnreachable,
  decimalToRadix252,
  fromRadix252, hexToRadix252, radix252ToHex,
  toRadix252
} from './utils'

export type HexString = string

export type EChainState = {
  // Latest block number
  // TODO(low): refactor to string
  bn: number
  // Radix252 timestamp string of latest block
  ts: string
  // Radix252 wei string
  gas: string
}

export const initChainState: EChainState = {
  bn: 0,
  ts: toRadix252(0),
  gas: toRadix252(0),
}

export type GlobalState = {
  eth?: EChainState
}

export const ADDRESS_TYPE = 'a'
export const BLOCK_TYPE = 'b'
export const TRANSACTION_TYPE = 't'

export const ALL_ADDR_TYPES = [ADDRESS_TYPE, BLOCK_TYPE, TRANSACTION_TYPE] as const

export const CONTRACT_CREATED = 'c'
export const RX = 'r'
export const TX = 'tx'
export const CHILD_TRANSACTION = 'tp'
export const PARENT_BLOCK = 'pb'
export const MINER = 'm'

export const ALL_REL_TYPES = [CONTRACT_CREATED, RX, TX, CHILD_TRANSACTION, PARENT_BLOCK, MINER]

export type NodeType = typeof ADDRESS_TYPE | typeof BLOCK_TYPE | typeof TRANSACTION_TYPE

export type TypeToNode = {
  [ADDRESS_TYPE]: Address
  [BLOCK_TYPE]: Block
  [TRANSACTION_TYPE]: Transaction
}
export type NodeToType<N extends GraphNodes> =
  | (N extends Address ? typeof ADDRESS_TYPE : never)
  | (N extends Block ? typeof BLOCK_TYPE : never)
  | (N extends Transaction ? typeof TRANSACTION_TYPE : never)
  | never

export type GraphNode = {
  id: `${NodeType},${string}`
}

export type PaginatedNode = FullAddress;

export type EnsName = `${string}.eth`

export function isEnsName(ensName: string): ensName is EnsName {
  return ensName.endsWith('.eth')
}

// AddressType is 'c'ontract or 'w'allet
export type AddressType = 'c' | 'w'
export type Address = GraphNode & {
  id: `${typeof ADDRESS_TYPE},${string}`
  name?: string
}
export type FullAddress = Address & {
  t: AddressType // Either c for Contract or w for personal wallet
  // wei as radix252 string
  eth: string
  // Last updated time as radix252 unix ms
  ts: string
  // First seen time (created) as radix252 unix ms
  c: string
}

export type Block = GraphNode & {
  id: `${typeof BLOCK_TYPE},${string}`
}

export type FullBlock = Block & {
  miner: string // rad252 version

  // These fields mostly mirror the _Block type in Ethers.js
  // Just about all string numbers are radix252 encoded
  hash: string
  parentHash: string
  number: string
  ts: string
  nonce: string
  difficulty: number
  //_difficulty: string
  gasLimit: string
  gasUsed: string
  extraData: string
  //baseFeePerGas?: string
}

export type Transaction = GraphNode & {
  id: `${typeof TRANSACTION_TYPE},${string}`
}

export type FullTransaction = Transaction & {
  // wei as radix252 string
  eth: string
  // block number as radix252 string
  blockNumber: string

  // Mostly a serialization-friendly frontend version of Ethers.js' Transaction
  hash: string

  // to address in hex form
  to: string
  // from address in hex form
  from: string
  nonce: string

  // Gas used in Radix252
  gasUsed: string
  gasLimit: string
  gasPrice: string

  // 0 or 1 for fail or success
  status: 0 | 1,

  //data: string
  //chainId: number

  r?: string
  s?: string
  v?: number

  // Typed-Transaction features
  //type?: number | null;

  // EIP-2930; Type 1 & EIP-1559; Type 2
  //accessList?: AccessList;

  // EIP-1559; Type 2
  //maxPriorityFeePerGas?: string
  //maxFeePerGas?: string
}

export type RelationType =
  | typeof CONTRACT_CREATED
  | typeof RX
  | typeof TX
  | typeof CHILD_TRANSACTION
  | typeof PARENT_BLOCK
  | typeof MINER

export type TypeToRelation = {
  [CONTRACT_CREATED]: ContractCreated
  [RX]: Rx
  [TX]: Tx
  [CHILD_TRANSACTION]: ChildTransaction
  [PARENT_BLOCK]: ParentBlock
  [MINER]: Miner
}

export type RelationToType<R extends Relations> =
  | (R extends ContractCreated ? typeof CONTRACT_CREATED : never)
  | (R extends Rx ? typeof RX : never)
  | (R extends Tx ? typeof TX : never)
  | (R extends ChildTransaction ? typeof CHILD_TRANSACTION : never)
  | (R extends ParentBlock ? typeof PARENT_BLOCK : never)
  | (R extends Miner ? typeof MINER : never)
  | never

// Legal relation types
export type RelationToNodeTypes = {
  [CONTRACT_CREATED]: [Transaction, Address]
  [RX]: [Transaction, Address]
  [TX]: [Address, Transaction]
  [CHILD_TRANSACTION]: [Block, Block]
  [PARENT_BLOCK]: [Block, Transaction]
  [MINER]: [Address, Block]
}

type Relation = {
  id: `${RelationType},${string}`
  ts: string
}

type NewRelation<R extends RelationType> = Relation & {
  id: `${R},${RelationToNodeTypes[R][0]['id']}-${RelationToNodeTypes[R][1]['id']}`
}

export type ContractCreated = NewRelation<typeof CONTRACT_CREATED> & {
  val: string
}

export type Rx = NewRelation<typeof RX> & {
  val: string
}

export type Tx = NewRelation<typeof TX> & {
  val: string
}

export type ParentBlock = NewRelation<typeof PARENT_BLOCK> & {}

export type ChildTransaction = NewRelation<typeof CHILD_TRANSACTION> & {}

export type Miner = NewRelation<typeof MINER> & {
  val?: string
}

// Concrete subtypes
export type GraphNodes = Address | Block | Transaction
export type FullNodes = FullAddress | FullBlock | FullTransaction
export type Relations = ContractCreated | Rx | Tx | ParentBlock | ChildTransaction | Miner
export type GraphObjs = GraphNodes | Relations
export type FullGraphObjs = FullNodes | Relations
export type Id = GraphObjs['id']

export type NodeToRelations = {
  [ADDRESS_TYPE]: Rx | Tx | Miner | ContractCreated
  [BLOCK_TYPE]: Miner | ChildTransaction | ParentBlock
  [TRANSACTION_TYPE]: ContractCreated | Rx | Tx | ChildTransaction
}
export type AddressRelations = NodeToRelations[typeof ADDRESS_TYPE]
export type BlockRelations = NodeToRelations[typeof BLOCK_TYPE]
export type TransactionRelations = NodeToRelations[typeof TRANSACTION_TYPE]

export function getObjId(id: GraphObjs['id']): string {
  return id.split(',')[1]
}

// Same as getObjId but parsed the native ID instead of DG ID
export function parseNativeNodeId(id: GraphNodes['id']): string {
  if (isBlockId(id)) {
    return `${parseBlockNumber(id)}`
  } else if (isAddressId(id) || isTransactionId(id)) {
    return parseHexId(id)
  }
  assertUnreachable(id)
}

export function getGraphType<G extends GraphObjs>(
  id: G['id']
): G extends GraphNodes ? NodeToType<G> : G extends Relations ? RelationToType<G> : never {
  return id.split(',')[0] as G extends GraphNodes
    ? NodeToType<G>
    : G extends Relations
    ? RelationToType<G>
    : never
}

export function nodeId<N extends NodeType>(objtype: N, objid: string): TypeToNode[N]['id'] {
  return `${objtype},${objid}` as TypeToNode[N]['id']
}

export type RelationToIdTypes<R extends RelationType> = [
  RelationToNodeTypes[R][0]['id'],
  RelationToNodeTypes[R][1]['id']
]
export function getSourceDestFromRel<R extends Relations>(
  relId: R['id']
): RelationToIdTypes<RelationToType<R>> {
  const halves = relId.split('-')
  // Src is first half with the relation type prefix removed
  const src = halves[0].substring(halves[0].indexOf(',') + 1) as RelationToIdTypes<
    RelationToType<R>
  >[0]
  const dest = halves[1] as RelationToIdTypes<RelationToType<R>>[1]
  return [src, dest] as RelationToIdTypes<RelationToType<R>>
}

export function relationId<
  R extends RelationType,
  N1 extends GraphNodes,
  N2 extends GraphNodes
>(relType: R, n1Id: N1['id'], n2Id: N2['id']): TypeToRelation[R]['id'] {
  return `${relType},${n1Id}-${n2Id}` as TypeToRelation[R]['id']
}

export function isGraphObj(node: object): node is GraphObjs {
  return typeof (node as GraphObjs)['id'] === 'string'
}

export function isAddress(node: object): node is Address {
  const id = (node as Address).id
  return id && isAddressId(id)
}

export function isAddressId(nodeId: string): nodeId is Address['id'] {
  return nodeId.startsWith(ADDRESS_TYPE)
}

export function isFullAddress(node: object): node is FullAddress {
  return isAddress(node) && typeof (node as FullAddress)['eth'] === 'string'
}

export function isBlock(node: object): node is Block {
  const id = (node as Block).id
  return id && isBlockId(id)
}

export function isBlockId(nodeId: string): nodeId is Block['id'] {
  return nodeId.startsWith(`${BLOCK_TYPE},`)
}

export function isFullBlock(node: object): node is FullBlock {
  return isBlock(node) && typeof (node as FullBlock).number === 'string'
}

export function isTransaction(node: object): node is Transaction {
  const id = (node as Transaction).id
  return id && id.startsWith(`${TRANSACTION_TYPE},`)
}

export function isTransactionId(nodeId: string): nodeId is Transaction['id'] {
  return nodeId.startsWith(`${TRANSACTION_TYPE},`)
}

export function isFullTransaction(node: object): node is FullTransaction {
  return isTransaction(node) && typeof ((node as FullTransaction).eth) !== 'undefined'
}

export function isGraphNodeId(nodeId: string): nodeId is GraphNodes['id'] {
  return isAddressId(nodeId) || isBlockId(nodeId) || isTransactionId(nodeId)
}

export function isGraphNode(node: object): node is GraphNodes {
  return isGraphObj(node) && isGraphNodeId(node.id)
}

export function isFullNode(node: GraphObjs): node is FullNodes {
  return isFullAddress(node) || isFullBlock(node) || isFullTransaction(node)
}

export function isRelation(node: GraphObjs): node is Relations {
  return typeof node === 'object' && isGraphObj(node) && !isGraphNode(node)
}

export function isRelationId(relId: string): relId is Relations['id'] {
  return !isGraphNodeId(relId) && relId.length > 2 && ALL_REL_TYPES.includes(relId[0]) && relId[1] === ','
}

export function isContractCreated(obj: GraphObjs): obj is ContractCreated {
  return obj['id'] && obj.id.startsWith(`${CONTRACT_CREATED},`)
}

export function isRx(obj: GraphObjs): obj is Rx {
  return obj['id'] && obj.id.startsWith(`${RX},`)
}

export function isTx(obj: GraphObjs): obj is Tx {
  return obj['id'] && obj.id.startsWith(`${TX},`)
}

export function isChildTransaction(obj: GraphObjs): obj is ChildTransaction {
  return obj['id'] && obj.id.startsWith(`${CHILD_TRANSACTION},`)
}

export function isParentBlock(obj: GraphObjs): obj is ParentBlock {
  return obj['id'] && obj.id.startsWith(`${PARENT_BLOCK},`)
}

export function isMiner(obj: GraphObjs): obj is Miner {
  return obj['id'] && obj.id.startsWith(`${MINER},`)
}

export function isPaginatedNodeId(nodeId: string): nodeId is PaginatedNode['id'] {
  return isAddressId(nodeId);
}

// Serialization stuff

export type HexIdNodes = Address | Transaction

export function parseBlockNumber(id: Block['id']): bigint {
  const blockIdStr = getObjId(id)
  return fromRadix252(blockIdStr)
}

// The 0x-prefix eth address from an Address id or transaction hash
export function parseHexId(id: HexIdNodes['id']): string {
  const blockIdStr = getObjId(id)
  const objType = getGraphType<HexIdNodes>(id)
  let asHex = radix252ToHex(blockIdStr)

  // Pad till there's at least 40 characters
  let requiredCharCount = 0
  if (objType === ADDRESS_TYPE) {
    requiredCharCount = 40
  } else if (objType === TRANSACTION_TYPE) {
    requiredCharCount = 64
  } else {
    assertUnreachable(objType)
  }
  while (asHex.length < requiredCharCount) {
    asHex = `0${asHex}`
  }
  return `0x${asHex}`
}

export function newHexValuedId<NT extends NodeToType<HexIdNodes>>(
  hex: string,
  nodeType: NT
): TypeToNode[NT]['id'] {
  return nodeId(nodeType, hexToRadix252(hex)) as TypeToNode[NT]['id']
}

export function newNumberValuedId<N extends Block>(
  blockNumber: bigint,
  nodeType: NodeToType<N>
) {
  return nodeId(nodeType, decimalToRadix252(blockNumber.toString()))
}

export function relationToWei(rel: Relations): bigint {
  if (isTx(rel) || isContractCreated(rel)) {
    return -fromRadix252(rel.val)
  } else if (isRx(rel)) {
    return fromRadix252(rel.val)
  } else if (isParentBlock(rel) || isChildTransaction(rel)) {
    return BigInt(0)
  } else if (isMiner(rel)) {
    // TODO: Make mined wei accurate!!!
    return rel.val ? fromRadix252(rel.val!) : BigInt('3000000000000000000')
  }
  assertUnreachable(rel)
}
