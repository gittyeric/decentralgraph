import { createClient } from "redis";
import { RedisBloomCuckoo } from "redis-modules-sdk";
import { config } from "../../config/config";

type RedisNativeClient = ReturnType<typeof createClient>;

export type RedisClient = {
  client: RedisNativeClient;
  cuckoo: RedisBloomCuckoo;
};

const conn = {
  url: config.edge.redisUrl,
  username: config.edge.redisUsername,
  password: config.edge.redisPassword,
};

let client: RedisClient | null = null;
export async function getRedis(): Promise<RedisClient> {
  if (!client) {
    const newModuleClient = new RedisBloomCuckoo(conn);
    const newClient = await createClient(conn);
    await newModuleClient.connect();
    await newClient.connect();
    client = {
      client: newClient,
      cuckoo: newModuleClient,
    };
  }

  return client;
}
