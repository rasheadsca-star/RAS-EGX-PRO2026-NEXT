import { buildDefaultService, createAppServer } from './src/server.mjs';
import { config } from './src/config.mjs';

const service = buildDefaultService();
const server = createAppServer({ service });
server.listen(config.port, () => {
  console.log(`EGX Audit Core listening on port ${config.port}`);
});
