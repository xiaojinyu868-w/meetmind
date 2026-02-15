/* eslint-disable no-console */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function hasPrismaClient() {
  const clientPath = path.join(process.cwd(), 'node_modules', '@prisma', 'client');
  return fs.existsSync(clientPath);
}

try {
  execSync('npm run prisma:generate', { stdio: 'inherit' });
} catch (error) {
  if (hasPrismaClient()) {
    console.warn('[prebuild] prisma generate failed; use existing @prisma/client and continue build.');
    process.exit(0);
  }
  console.error('[prebuild] prisma generate failed and @prisma/client is missing.');
  throw error;
}
