import { asBinary, open } from 'lmdb';
import { config } from '../../config/config';
import { Erc20Details } from './graph/fetch-ethereum';
import { GraphCursor } from '../../../frontend/src/features/graph/global/fetch-contract';
import { Address, AddressRelations, EChainState, FullAddress, HexString } from '../../../frontend/src/features/graph/global/types';
import { EthAggregates } from './graph/state/core-aggs';
import { CHAIN_STATE_KEY } from './graph/state/core-init';

export const ethRelsDatabase = open(config.core.lmdbEthRoot + '/rels', {
    name: 'eth',
})

export const ensDatabase = open(config.core.lmdbEthRoot + '/ens', {
    name: 'ens',
})

export const abiDatabase = open(config.core.lmdbEthRoot + '/abi', {
    name: 'abi',
    compression: true,
})

export const addrDatabase = open(config.core.lmdbEthRoot + '/addr', {
    name: 'addr',
    compression: true,
})

export const erc20Database = open(config.core.lmdbEthRoot + '/erc20', {
    name: 'erc20',
})

const ethTimelineDatabase = open(config.core.lmdbEthRoot + '/agg', {
    name: 'ethtimeline'
})

// ------------------------------------------------

export const chainStateDb = ethRelsDatabase.openDB<EChainState, typeof CHAIN_STATE_KEY>({
    name: 'chain2',
});

export const addrRelsDB = ethRelsDatabase.openDB<AddressRelations, GraphCursor>({
    name: 'addrrels',
});

export const addrDB = addrDatabase.openDB<FullAddress, Address['id']>({
    name: 'addr',
    cache: true
});

export const ensDB = ensDatabase.openDB<Address['id'], string>({
    name: 'ens',
});

export const contractToCodeHashDB = abiDatabase.openDB<string, Address['id']>({
    name: 'code',
});

export const codeHashToContractsDB = abiDatabase.openDB<Address['id'][], string>({
    name: 'codeContracts',
});

export const erc20DB = erc20Database.openDB<Erc20Details, Address['id']>({
    name: 'erc20',
});

export const ethTimelineDB = ethTimelineDatabase.openDB<EthAggregates, string>({
    name: 'timeline'
})
