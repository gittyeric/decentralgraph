import { Server } from "socket.io";
import { config } from "../config/config";
import { newMemLruCache } from "../../frontend/src/features/graph/global/cache-mem";
import { cachedGraphFetcher } from "../../frontend/src/features/graph/global/fetch-cache";
import { newWsFetcher } from "../../frontend/src/features/graph/global/fetch-ws";
import { instrumentDebug } from "../../frontend/src/features/graph/global/utils";
import { newContractEndpoints, wireEndpointsToSocket } from './server/graph/respond-ws';
import { newHealthApp } from "./server/health";

// Edge servers basically just implement GraphFetcher over Socket.io and that's it!
const debug = instrumentDebug('')

debug('hello edge!')
debug('Starting edge on port ' + config.edge.edgePort)
const io = new Server(config.edge.edgePort, {
  pingInterval: 45000,
  pingTimeout: 40000,
  cors: {
    origin: [
      'http://decentralgraph.com', 'https://decentralgraph.com',
      'http://localhost', 'http://localhost:3000'],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: "*",
  },
});

const wsFetcher = newWsFetcher(config.edge.coreWsUrl, 500000) // TODO!: Restore 5000
const fetchLruCache = newMemLruCache(20000, 100, 1000, 1000 * 60 * 60 * 24)
const cachedFetcher = cachedGraphFetcher(fetchLruCache, wsFetcher, true, 'mem', false)

io.on("connection", (socket) => {
  wireEndpointsToSocket(socket, Object.values(newContractEndpoints(cachedFetcher)))
});

newHealthApp(9000)
