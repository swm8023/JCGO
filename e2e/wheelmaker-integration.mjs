// Build .stage/wheelmaker-integration/bin and web/dist before running this harness.
// All data and listeners belong to an isolated run; production data is read-only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, cp, access, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, '.stage/wheelmaker-integration/bin');
const suffix = process.platform === 'win32' ? '.exe' : '';
const evidence = await mkdtemp(join(tmpdir(), 'jcgo-wheelmaker-e2e-'));
const model = 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz';
const token = 'isolated-e2e-token';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(30); }
  throw new Error('Timed out: ' + description);
}
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}
async function home(name) {
  const dir = join(evidence, name); await mkdir(dir, { recursive: true });
  for (const name of ['bin', 'config', 'model']) await mkdir(join(dir, name));
  await cp(join(root, 'web/dist'), join(dir, 'web'), { recursive: true });
  await cp(join(bin, 'test-katago' + suffix), join(dir, 'bin/katago' + suffix));
  await writeFile(join(dir, 'model', model), 'fixture');
  await writeFile(join(dir, 'config/analysis_config.cfg'), '');
  await mkdir(join(dir, 'web/other'));
  await writeFile(join(dir, 'web/other/sw.js'), "self.addEventListener('install', () => self.skipWaiting());self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));");
  const port = await freePort();
  await writeFile(join(dir, 'config.json'), JSON.stringify({ server: { enabled: true, port, token }, worker: { enabled: true, name: 'browser-worker', url: `ws://127.0.0.1:${port}/worker`, token }, hub: { enabled: false }, log: { level: 'warn' } }));
  return { dir, port, url: `http://127.0.0.1:${port}` };
}

const processes = new Set();
class ManagedProcess {
  frames = []; stderr = ''; next = 1;
  constructor(role, state, extra = {}) {
    this.role = role; this.identity = { appId: 'jcgo-' + role, instanceId: role + '-instance' };
    this.process = spawn(join(bin, (role === 'server' ? 'jcgo' : 'jcgo-worker') + suffix), ['--dir', state.dir], {
      cwd: state.dir, windowsHide: true, env: { ...process.env, WHEELMAKER_APP_MANAGED: '1', ...extra }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    processes.add(this); this.process.stdin.on('error', () => {});
    this.process.stderr.on('data', (data) => { this.stderr += data; });
    this.exit = new Promise((resolve, reject) => { this.process.once('exit', (code) => { this.code = code; processes.delete(this); resolve(code); }); this.process.once('error', reject); });
    createInterface({ input: this.process.stdout }).on('line', (line) => {
      try { assert(Buffer.byteLength(line) + 1 <= 8192); const frame = JSON.parse(line); assert.equal(frame.appId, this.identity.appId); assert.equal(frame.instanceId, this.identity.instanceId); this.frames.push(frame); }
      catch (error) { this.problem = error; }
    });
    this.send('initialize', { protocol: 1 });
  }
  send(method, fields = {}) { const requestId = this.next++; this.process.stdin.write(JSON.stringify({ type: 'request', requestId, method, ...this.identity, ...fields }) + '\n'); return requestId; }
  async frame(predicate, description) {
    let found;
    await until(() => { if (this.problem) throw this.problem; found = this.frames.find(predicate); if (found) return true; if (this.code !== undefined) throw new Error(this.role + ' exited ' + this.code + ': ' + this.stderr); return false; }, description);
    return found;
  }
  async ready() { return this.frame((frame) => frame.type === 'ready', this.role + ' ready'); }
  async health() { const id = this.send('health'); return (await this.frame((frame) => frame.requestId === id, this.role + ' health')).health; }
  async stop(eof = false) {
    if (this.code !== undefined) return;
    if (eof) this.process.stdin.end(); else { const id = this.send('shutdown'); await this.frame((frame) => frame.requestId === id, this.role + ' shutdown acknowledgment'); }
    await until(() => this.code !== undefined, this.role + ' exit', 12_000);
    assert.equal(this.code, 0, this.stderr); assert(!this.stderr.includes(token), 'credential leaked into stderr');
  }
}

async function rpc(state) {
  const ws = new WebSocket(`ws://127.0.0.1:${state.port}/jcgo/ws`, ['jcgo-jsonrpc', 'token.' + token]);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0; const pending = new Map();
  ws.onmessage = ({ data }) => { const reply = JSON.parse(data); const callback = pending.get(reply.id); if (callback) { pending.delete(reply.id); if (reply.error) callback.reject(new Error(JSON.stringify(reply.error))); else callback.resolve(reply.result); } };
  return { close: () => ws.close(), call: (method, params) => new Promise((resolve, reject) => {
    const id = String(++sequence); const timer = setTimeout(() => { pending.delete(id); reject(new Error('RPC timeout ' + method)); }, 120_000);
    pending.set(id, { resolve: (result) => { clearTimeout(timer); resolve(result); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  }) };
}
async function startAnalysis(connection, title) {
  await until(async () => (await connection.call('workspace.state')).workerStatus.available > 0, 'Worker connection');
  await connection.call('worker.configure', { workerName: 'browser-worker', model, maxVisits: 4, priority: 1 });
  const imported = await connection.call('game.importSgf', { displayName: title, sgfText: '(;GM[1]FF[4]SZ[19]KM[7.5];B[pd])' });
  await connection.call('game.setAnalysisWorker', { gameId: imported.game.gameId, workerName: 'browser-worker' });
  await connection.call('analysis.start', { gameId: imported.game.gameId });
}

const results = [];
let browser;
try {
  const state = await home('browser');
  const server = new ManagedProcess('server', state); await server.ready();
  const worker = new ManagedProcess('worker', state, { JCGO_TEST_SLOW_ANALYSIS: '1', JCGO_TEST_QUERY_STARTED: join(state.dir, 'query.started'), JCGO_TEST_CHILD_PID: join(state.dir, 'child.pid') }); await worker.ready();
  const duplicate = new ManagedProcess('server', state); assert.notEqual(await duplicate.exit, 0); assert(duplicate.stderr.includes('already running'));
  const connection = await rpc(state); await startAnalysis(connection, 'Browser fixture');
  await until(async () => { try { await access(join(state.dir, 'query.started')); return true; } catch { return false; } }, 'long analysis started');
  const healthStart = Date.now(); assert.equal((await worker.health()).state, 'healthy'); assert(Date.now() - healthStart < 1000, 'health blocked during analysis');
  await worker.stop(); assert.equal(server.code, undefined); assert.equal((await connection.call('game.list')).games.length, 1);
  results.push('Managed roots: duplicate exclusion, health during long analysis, Worker stop with live Server');

  const { chromium } = createRequire(import.meta.url)('playwright');
  const kotlin = await readFile(join(root, 'mobile/android/app/src/main/java/com/jcgo/android/MainActivity.kt'), 'utf8');
  const cleanupScript = kotlin.match(/val CLEAR_REMOTE_STATE_SCRIPT = """([\s\S]*?)"""\.trimIndent/)[1];
  for (const base of ['/', '/jcgo/']) {
    const context = await chromium.launchPersistentContext(join(evidence, base === '/' ? 'profile-root' : 'profile-prefix'), { channel: 'msedge', headless: true });
    browser = context;
    const page = await context.newPage(); const errors = []; const sockets = [];
    page.on('pageerror', (error) => errors.push(String(error))); page.on('websocket', (ws) => sockets.push(ws.url()));
    await page.goto(state.url + base, { waitUntil: 'networkidle' });
    assert(await page.getByLabel('Access token').isVisible());
    await page.getByLabel('Access token').fill(token); await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByLabel('Access token').waitFor({ state: 'detached' }); assert(sockets.some((url) => url.endsWith(base + 'ws')));
    await page.evaluate(() => navigator.serviceWorker.ready); await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const cdp = await context.newCDPSession(page);
    const installability = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installability.installabilityErrors, [], 'PWA is not installable at ' + base);
    await cdp.detach();
    const manifest = await page.evaluate(async () => { const url = document.querySelector('link[rel="manifest"]').href; return { url, value: await (await fetch(url)).json() }; });
    for (const field of ['id', 'scope', 'start_url']) assert.equal(new URL(manifest.value[field], manifest.url).pathname, base);
    const prefix = base === '/' ? 'jcgo-' : 'jcgo-' + encodeURIComponent(base) + '-';
    await page.evaluate(async ({ base, prefix }) => {
      await caches.open('tato-test-cache'); await caches.open(prefix + 'static-v0');
      localStorage.setItem('tato.test', 'keep'); sessionStorage.setItem('tato.test', 'keep');
      await navigator.serviceWorker.register('/other/sw.js', { scope: '/other/' });
      const data = new FormData(); data.append('sgf', new File(['(;GM[1]SZ[19])'], 'shared.sgf', { type: 'text/plain' }));
      const response = await fetch(base + 'share-target', { method: 'POST', body: data });
      if (new URL(response.url).pathname !== base) throw Error('share redirect escaped entry');
      const stored = await (await fetch(base + 'shared-sgf/latest')).json();
      if (stored.files[0].name !== 'shared.sgf') throw Error('shared SGF was not stored');
    }, { base, prefix });
    await appendFile(join(state.dir, 'web/sw.js'), '\n// isolated update ' + base + '\n');
    await page.evaluate(async (base) => { const reg = await navigator.serviceWorker.getRegistration(base); await reg.update(); }, base);
    await page.waitForFunction(async (oldCache) => !(await caches.keys()).includes(oldCache), prefix + 'static-v0');
    const retained = await page.evaluate(async (base) => ({ caches: await caches.keys(), shared: await (await fetch(base + 'shared-sgf/latest')).json() }), base);
    assert(retained.caches.includes('tato-test-cache')); assert.equal(retained.shared.files[0].name, 'shared.sgf');
    await page.screenshot({ path: join(evidence, base === '/' ? 'root.png' : 'prefix.png') });
    await page.evaluate(cleanupScript); await page.waitForFunction(() => window.__jcgoCleanupDone === true);
    const cleaned = await page.evaluate(async () => ({ token: localStorage.getItem('jcgo.accessToken'), other: localStorage.getItem('tato.test'), session: sessionStorage.getItem('tato.test'), caches: await caches.keys(), workers: (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname) }));
    assert.equal(cleaned.token, null); assert.equal(cleaned.other, 'keep'); assert.equal(cleaned.session, 'keep');
    assert(cleaned.caches.includes('tato-test-cache')); assert(cleaned.workers.includes('/other/')); assert(!cleaned.workers.includes(base));
    assert.equal(errors.length, 0, errors.join('\n')); await context.close(); browser = undefined;
    results.push('Browser ' + base + ': resources/login, manifest/SW, SGF share/update, Android cleanup isolation');
  }
  connection.close(); await server.stop(true);

  const merge = await home('merge'); const hubDir = join(evidence, 'merge-hub'); await mkdir(hubDir);
  for (const name of ['jcgo', 'jcgo-worker']) await cp(join(bin, name + suffix), join(merge.dir, 'bin', name + suffix));
  await writeFile(join(hubDir, 'config.json'), JSON.stringify({ token: 'keep-hub-token', projects: [{ id: 'keep-project' }], apps: [{ id: 'tato', executable: 'C:/tato/server.exe' }] }));
  const mergeChild = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/connect-wheelmaker.ps1'), '-JcgoDir', merge.dir, '-HubStateDir', hubDir], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let mergeErrors = ''; mergeChild.stderr.on('data', (data) => { mergeErrors += data; }); assert.equal((await once(mergeChild, 'exit'))[0], 0, mergeErrors);
  const mergedHub = JSON.parse(await readFile(join(hubDir, 'config.json'), 'utf8')); const mergedApp = JSON.parse(await readFile(join(merge.dir, 'config.json'), 'utf8'));
  assert.equal(mergedHub.token, 'keep-hub-token'); assert.equal(mergedHub.projects[0].id, 'keep-project'); assert.deepEqual(mergedHub.apps.map((app) => app.id), ['tato', 'jcgo-server', 'jcgo-worker']); assert.equal(mergedApp.server.token, token); assert.equal(mergedApp.hub.enabled, true);
  results.push('Config merge preserves Hub token/projects/Tato and JCGO tokens');

  if (process.env.JCGO_REAL_HOME) {
    const real = await home('real-gpu'); const installed = process.env.JCGO_REAL_HOME;
    await cp(join(installed, 'bin'), join(real.dir, 'bin'), { recursive: true });
    await cp(join(installed, 'model', model), join(real.dir, 'model', model));
    await cp(join(installed, 'config/analysis_config.cfg'), join(real.dir, 'config/analysis_config.cfg'));
    const realServer = new ManagedProcess('server', real); await realServer.ready(); const realWorker = new ManagedProcess('worker', real); await realWorker.ready();
    const realRPC = await rpc(real); await startAnalysis(realRPC, 'Real GPU verification');
    await until(async () => { const state = await realRPC.call('workspace.state'); if (state.analysisError) throw Error(state.analysisError); return state.timeline.rootVisits.some((visits) => visits > 0); }, 'real KataGo result', 120_000);
    await realWorker.stop(); await realServer.stop(); realRPC.close(); results.push('Installed KataGo + b18: actual analysis result through managed Worker');
  }
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ results, androidDevice: 'No ADB device attached; JVM and actual cleanup JavaScript verified' }, null, 2));
  console.log(JSON.stringify({ evidence, results }, null, 2));
} finally {
  if (browser) await browser.close();
  for (const child of processes) { try { await child.stop(true); } catch { child.process.kill(); } }
}
