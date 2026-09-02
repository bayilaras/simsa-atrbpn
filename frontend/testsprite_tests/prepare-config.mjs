import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Required environment variable ${name} is not set.`);
  }
  return value;
}

const loginUser = requiredEnv('SIMSA_TEST_EMAIL');
const loginPassword = requiredEnv('SIMSA_TEST_PASSWORD');
const apiKey = requiredEnv('TESTSPRITE_API_KEY');
const proxy = requiredEnv('TESTSPRITE_PROXY_URL');
const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = dirname(scriptDir);
const outputDir = join(scriptDir, 'tmp');
const outputPath = join(outputDir, 'config.json');

const config = {
  status: 'commited',
  type: 'frontend',
  scope: 'codebase',
  localEndpoint: process.env.TESTSPRITE_LOCAL_ENDPOINT?.trim() || 'http://localhost:3000',
  loginUser,
  loginPassword,
  executionArgs: {
    projectName: 'frontend',
    projectPath: frontendDir.replaceAll('\\', '/'),
    testIds: ['TC008', 'TC009', 'TC011'],
    additionalInstruction: 'Use the supplied loginUser/loginPassword fields. Login page /login, button text "Masuk". Run ONLY these 3 test cases.',
    envs: { API_KEY: apiKey },
  },
  serverPort: Number.parseInt(process.env.TESTSPRITE_SERVER_PORT || '53981', 10),
  proxy,
};

if (!Number.isInteger(config.serverPort) || config.serverPort < 1 || config.serverPort > 65535) {
  throw new Error('TESTSPRITE_SERVER_PORT must be a valid TCP port.');
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Generated ignored TestSprite runtime config at ${outputPath}\n`);
