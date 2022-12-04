export default {
    isProd: true,
    core: {
        bridgePort: 8080,
        ethWs: "http://localhost:8545",
        lmdbEthRoot: "/main",
        //lmdbBtcRoot: "/btc",
        //lmdbArchiveRoot: '/huge',
    },
    edge: {
        edgePort: 80,
        redisUrl: "redis://localhost:6379",
        coreWsUrl: "http://bridge.decentralgraph.com:8080",
        redisUsername: undefined as string | undefined,
        redisPassword: undefined as string | undefined,
    }
} as const
