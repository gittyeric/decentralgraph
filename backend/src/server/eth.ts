import { config } from "../../config/config";
import { ethers } from "ethers";
import { instrumentDebug } from "../../../frontend/src/features/graph/global/utils";

const debug = instrumentDebug('eth')

debug(`connecting to Eth WS ${config.core.ethWs}`)
export const provider = new ethers.providers.JsonRpcProvider(config.core.ethWs);

const connection = provider.getBlockNumber()
connection.then((bn) => debug('connected to WS'))
connection.catch((e) => {
    debug('Couldnt connect to WS!')
    process.exit(1)
})
