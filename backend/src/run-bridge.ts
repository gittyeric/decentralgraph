import { newContractEndpoints, wireEndpointsToSocket } from './server/graph/respond-ws'
import { Server } from "socket.io";
import { newCoreFetcher } from './server/graph/fetch-core';
import { config } from '../config/config';
import { newMemLruCache } from '../../frontend/src/features/graph/global/cache-mem';
import { instrumentDebug } from '../../frontend/src/features/graph/global/utils';
import { bridgeLogger } from './util';
import { addShutdownCallback, setShutdownGraceMs } from './server/server-utils';

const debug = instrumentDebug('run-bridge', [bridgeLogger.info, console.info])

// Bridge servers implement GraphFetcher over full node APIs and custom indexes.

debug('Starting bridge on port ' + config.core.bridgePort)
const fetcher = newCoreFetcher()

const io = new Server(config.core.bridgePort, {
  pingInterval: 45000,
  pingTimeout: 40000,
  cors: {
    origin: [
      'http://decentralgraph.com', 'https://decentralgraph.com', 'https://be.decentralgraph.com', 'https://edge.decentralgraph.com',
      'http://localhost', 'http://localhost:3000'],
    methods: ["GET", "POST"],
    allowedHeaders: "*",
  },
});

const fetchLruCache = newMemLruCache(5000, 100, 1000, 1000 * 60 * 60)
const coreFetcher = fetcher// TODO? cachedGraphFetcher(fetchLruCache, fetcher, true, 'mem', false)

io.on("connection", (socket) => {
  wireEndpointsToSocket(socket, Object.values(newContractEndpoints(coreFetcher)))
});

setShutdownGraceMs(500)
addShutdownCallback(async () => {
  io.disconnectSockets(true)
  debug('Disconnecting from clients')
})
