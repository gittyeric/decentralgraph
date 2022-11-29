import { getRedis, RedisClient } from "../../redis";
import { BloomKeyspaces } from "../cache-redis";
import { getChainState } from "../fetch-core";
import { CHAIN_STATE_KEY } from "./core-init";

// Used to size the Cuckoo existance cache properly
const MAX_ETH_ADDRESSES = 400000000;
const MAX_NUM_ETH_BLOCKS = 14850328 * 4; // Quadruple count from 2022?
const MAX_NUM_ETH_TRANSACTIONS = MAX_NUM_ETH_BLOCKS * 400; // Can be ~400 tx's per block

const MAX_REDIS_MEMORY_MB = 500;

const updateChainState = async (redis: RedisClient) => {
  const curChainState = await getChainState();
  await redis.client.set(CHAIN_STATE_KEY, JSON.stringify(curChainState));
};

export const initializeRedis = async () => {
  const redis = await getRedis();
  const isInitialized = (await redis.client.exists(CHAIN_STATE_KEY)) >= 1;
  if (isInitialized) {
    return;
  }
  // Configure Redis
  await redis.client.configSet("maxmemory", `${MAX_REDIS_MEMORY_MB}mb`);
  await redis.client.configSet("maxmemory-policy", "volatile-ttl");
  await redis.client.configRewrite();

  // Create the Addresses' cuckoo filter
  await redis.cuckoo.reserve(
    BloomKeyspaces.ADDRESSES,
    MAX_ETH_ADDRESSES,
    {
      bucketSize: 4, // 3 is about a 2.35% error rate for a big mem reduction
    }
  );

  // Create the block nodes' cuckoo filter
  await redis.cuckoo.reserve(
    BloomKeyspaces.TRANSACTIONS,
    MAX_NUM_ETH_TRANSACTIONS,
    {
      bucketSize: 5,
    }
  );

  // Initial metadata state to mark successful initialization
  await updateChainState(redis);
};
