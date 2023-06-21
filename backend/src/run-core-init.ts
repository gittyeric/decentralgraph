import { isShuttingDown, setShutdownGraceMs, shutdownGracefully } from './server/server-utils';
import { getChainState } from './server/graph/fetch-core';
import { instrumentDebug, sleep } from '../../frontend/src/features/graph/global/utils'
import { mainIndexingLoop } from './server/graph/state/core-init';
import { scanForEns } from './server/graph/state/scanner-ens';
import { chainStateDb } from './server/lmdb';
import { scanForByteCode } from './server/graph/state/scanner-code';
import { scanForERC20 } from './server/graph/state/scanner-erc20';
import { fetchEnsName } from './server/graph/fetch-ethereum';
import { coreLogger } from './util';

export const CORE_SHUTDOWN_GRACE_PERIOD = 6000

const debug = instrumentDebug('run-core-init', [coreLogger.info, console.log])

export const runCoreBatch = async () => {
  await fetchEnsName('0xd8da6bf26964af9d7eed9e03e53415d37aa96045').then((ens) => {
    debug('Successfully connected to Full Node')
  })
  // Start scanners
  scanForEns()
  scanForERC20()
  scanForByteCode()

  // Keep processing from last left off
  let lastChainState = await getChainState()
  debug(`Processing from block ${lastChainState.bn}`)
  await mainIndexingLoop(lastChainState.bn, true, chainStateDb)

  // Shutdown gracefully
  shutdownGracefully(0)
}

// Reference shutdown logic to trigger listener
setShutdownGraceMs(CORE_SHUTDOWN_GRACE_PERIOD)

runCoreBatch()

// Start fetching aggregate timeline data
//startFetchingTimelineAggs()
