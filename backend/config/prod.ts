export default {
    isProd: true,
    core: {
        bridgePort: +(process.env['BRIDGE_PORT'] || '8080'),
        ethWs: "http://localhost:8545",
        lmdbEthRoot: process.env['BRIDGE_ROOT'], // "/main",
    },
    edge: {
        edgePort: 80,
        redisUrl: "redis://localhost:6379",
        coreWsUrl: "http://bridge.decentralgraph.com:8080",
        // TODO:
        redisUsername: undefined as string | undefined,
        redisPassword: undefined as string | undefined,
    }
} as const
