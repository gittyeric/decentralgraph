export default {
    isProd: false,
    core: {
        bridgePort: 80,
        ethWs: "http://localhost:8545",
        lmdbEthRoot: "./testdb",
        lmdbArchiveRoot: './testdb',
        lmdbRootAddresses: "./testdb",
    },
    edge: {
        edgePort: 8080,
        redisUrl: "redis://localhost:6379",
        coreWsUrl: "http://bridge.decentralgraph.com",
        redisUsername: undefined as string | undefined,
        redisPassword: undefined as string | undefined,
    }
} as const
