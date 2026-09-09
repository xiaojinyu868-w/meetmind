import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

const git = (...args: string[]): Buffer => execFileSync('git', args, { maxBuffer: 20 * 1024 * 1024 });
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

async function main(): Promise<void> {
  const tracked = git('diff', '--name-only', '-z', 'HEAD').toString().split('\0').filter(Boolean);
  const added = git('ls-files', '--others', '--exclude-standard', '-z').toString().split('\0').filter(Boolean);
  const files = [...new Set([...tracked, ...added])];
  const allowed = /^(?:src\/|docs\/|tests\/|packages\/context-|examples\/context-client\/|ops\/hindsight\/|scripts\/context-handoff\.ts$|design-demo\/capability-board\/ledger\.json$|(?:AGENTS\.md|Makefile|tsconfig\.json|package(?:-lock)?\.json|prisma\/schema\.prisma|\.env\.example)$)/;
  for (const file of files) {
    if (!allowed.test(file) || file.split('/').includes('..') || /(?:^|\/)(?:node_modules|out|\.env(?:\.|$))/.test(file) && file !== '.env.example') {
      throw new Error(`Review unexpected changed path before packaging: ${file}`);
    }
    if (!/\.(?:ts|tsx|md|json|yaml|example)$/.test(file) && file !== 'Makefile' && file !== 'prisma/schema.prisma' && !file.endsWith('.py')) {
      throw new Error(`Unapproved file extension: ${file}`);
    }
  }
  const output = path.resolve('out/context-handoff', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(output, { recursive: true });
  const patch = git('diff', '--binary', 'HEAD', '--', ...tracked);
  await writeFile(path.join(output, 'tracked.patch'), patch);
  // Verify against HEAD in a disposable index; never touch the user's index or checkout.
  const verifyEnv = { ...process.env, GIT_INDEX_FILE: path.join(output, 'verify.index') };
  execFileSync('git', ['read-tree', 'HEAD'], { env: verifyEnv });
  execFileSync('git', ['apply', '--cached', '--check', path.join(output, 'tracked.patch')], { env: verifyEnv });
  const entries = [];
  for (const file of files) {
    const bytes = await readFile(file);
    // Reject recognizable credentials; environment files and databases are excluded by path.
    if (/-----BEGIN (?:OPENSSH|RSA|EC) PRIVATE KEY-----|\bsk-[A-Za-z0-9]{20,}|\bmmctx_[A-Za-z0-9_-]{24,}/.test(bytes.toString())) throw new Error(`Possible secret: ${file}`);
    const target = path.join(output, 'files', file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    if (digest(await readFile(target)) !== digest(bytes)) throw new Error(`Copy verification failed: ${file}`);
    entries.push({ path: file, status: added.includes(file) ? 'added' : 'modified', sha256: digest(bytes), bytes: bytes.length });
  }
  await copyFile('docs/plans/CONTEXT_SERVER_HANDOFF.md', path.join(output, 'START_HERE.md'));
  await writeFile(path.join(output, 'MANIFEST.json'), JSON.stringify({ base: git('rev-parse', 'HEAD').toString().trim(),
    createdAt: new Date().toISOString(), patchSha256: digest(patch), patchAppliesToBase: true, files: entries,
    instructions: 'Review START_HERE. Apply tracked.patch to the stated base, then copy only added files. files/ is also a final-content reference; do not overwrite a newer checkout wholesale. Secrets, runtime data and ignored evidence are excluded.' }, null, 2));
  process.stdout.write(`${output}\n${entries.length} source/document files copied and SHA-256 verified; no commit or push.\n`);
}
void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : 'handoff_failed'}\n`); process.exitCode = 1; });
