import express from 'express';
import { instrumentDebug } from '../../../frontend/src/features/graph/global/utils';

const debug = instrumentDebug('health')

const HOST = '0.0.0.0';
export function newHealthApp(
  port: number,
  ready: () => Promise<boolean> = () => Promise.resolve(true),
  live: () => Promise<boolean> = () => Promise.resolve(true)) {
  const app = express();

  app.get('/health/ready', async (req, res) => {
    try {
      await ready()
      res.send("Ready")
    } catch (e) {
      res.status(500).send()
    }
  })

  app.get('/health/live', async (req, res) => {
    try {
      await live()
      res.send("Live");
    } catch (e) {
      res.status(500).send()
    }
  })

  app.listen(port, HOST);
  debug(`Health up at http://${HOST}:${port}`);
}