import { provider } from './server/eth';
import { fetchEnsName } from './server/graph/fetch-ethereum';
import { instrumentDebug } from '../../frontend/src/features/graph/global/utils';

const debug = instrumentDebug('connect')

fetchEnsName('0xd8da6bf26964af9d7eed9e03e53415d37aa96045').then((ens) => {
    debug(JSON.stringify(ens))
})
