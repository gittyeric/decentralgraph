import express from 'express';
import { instrumentDebug } from '../../../frontend/src/features/graph/global/utils';

const debug = instrumentDebug('health')

const HOST = '0.0.0.0';
export function newHealthApp(port: number) {
  const app = express();

  app.get('/health/ready', (req, res) => {
    res.send("Ready");
  })

  app.get('/health/live', (req, res) => {
    res.send("Live");
  })

  app.listen(port, HOST);
  debug(`Health up at http://${HOST}:${port}`);
}