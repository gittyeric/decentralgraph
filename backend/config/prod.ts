export default {
    isProd: true,
    core: {
        bridgePort: 3000,
        ethWs: "http://localhost:8545",
        lmdbEthRoot: "/eth",
        //lmdbBtcRoot: "/btc",
        //lmdbArchiveRoot: '/huge',
    },
    edge: {
        edgePort: 80,
        redisUrl: "redis://localhost:6379",
        coreWsUrl: "http://bridge.decentralgraph.com",
        redisUsername: undefined as string | undefined,
        redisPassword: undefined as string | undefined,
    }
} as const
