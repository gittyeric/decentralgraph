import { instrumentDebug, sleep } from "../../../frontend/src/features/graph/global/utils";

let shuttingDown = false
let shutdownGraceMs = 1
const shutdownCallbacks: ((exitCode?: number) => Promise<unknown>)[] = []

const debug = instrumentDebug('shutdown')

// Kind of ugly global mutation / settings methods, but hey, shutdown IS global
export const isShuttingDown = () => shuttingDown
export const setShutdownGraceMs = (ms: number) => { shutdownGraceMs = ms }
export const addShutdownCallback = (callback: (exitCode?: number) => Promise<unknown>) => {
    shutdownCallbacks.push(callback)
}

export function shutdownGracefully(exitCode: number = -1) {
    if (!shuttingDown) {
        shuttingDown = true;
        debug('Received SIGTERM...')
        debug('Shutting down')
        let ttl = shutdownGraceMs

        const pendingCallbacks = Promise.all([
            sleep(shutdownGraceMs),
            ...shutdownCallbacks.map((c) => c(exitCode))
        ])
        pendingCallbacks.then(() => {
            debug('Shut down')
            if (1 === 1)
                process.exit()
            // And for good measure...
            process.kill(process.pid, 'SIGKILL')
        })

        debug(Math.round(ttl / 1000) + '...')
        setInterval(() => {
            ttl -= 1000
            debug(Math.round(ttl / 1000.0) + '...')
        }, 999)

    }
}

// TODO!
//process.on('SIGKILL', shutdown);
process.on('SIGTERM', shutdownGracefully);
//process.on('SIGINT', shutdownGracefully);

debug('Bound SIGTERM handler')
