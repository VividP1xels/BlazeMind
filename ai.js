// BlazeMind AI: one assistant for the launcher and for Minecraft itself.
// Works with Claude (Anthropic), ChatGPT (OpenAI), Gemini, Ollama (runs on your own PC, works offline)
// or any OpenAI-compatible server. In the game it talks through the BlazeMind Bridge mod.
const http = require('http');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const zlib = require('zlib');
const crypto = require('crypto');

const PROVIDERS = {
  claude: { name: 'Claude (Anthropic)', model: 'claude-opus-5-5', needsKey: true, keyHint: 'sk-ant-…  (console.anthropic.com → API keys)' },
  openai: { name: 'ChatGPT (OpenAI)', base: 'https://api.openai.com/v1', model: 'gpt-5', needsKey: true, keyHint: 'sk-…  (platform.openai.com → API keys)' },
  gemini: { name: 'Gemini (Google)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', needsKey: true, keyHint: 'AIza…  (aistudio.google.com → Get API key)' },
  ollama: { name: 'Ollama (on this PC, works offline)', base: 'http://127.0.0.1:11434/v1', model: 'llama3.1', needsKey: false, keyHint: 'No key needed. Install Ollama from ollama.com' },
  custom: { name: 'Other (OpenAI-compatible)', base: '', model: '', needsKey: false, keyHint: 'Key, if your server needs one' },
};

const cleanKey = k => String(k || '').replace(/^\s*(bearer|x-api-key:?)\s+/i, '').replace(/["'`\s]/g, '');

module.exports = function setupAI(d) {
  const { ipcMain, invoke, readInstance, instDir, readStore, writeStore, saveSecret, loadSecret, send, packFormat, installModrinth, writeInstance } = d;

  // ---------- settings ----------
  const cfg = () => {
    const s = readStore().ai || {};
    const provider = PROVIDERS[s.provider] ? s.provider : 'claude';
    return { provider, model: s.models?.[provider] || PROVIDERS[provider].model, base: s.bases?.[provider] || PROVIDERS[provider].base || '', echoToGame: s.echoToGame !== false };
  };
  ipcMain.handle('ai:settings', () => {
    const c = cfg(), s = readStore().ai || {};
    return { ...c, providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, { ...p, model: s.models?.[k] || p.model, base: s.bases?.[k] || p.base || '', keySet: !!loadSecret('aiKey-' + k) }])) };
  });
  ipcMain.handle('ai:saveSettings', (_e, p) => {
    const s = readStore().ai || {};
    const prov = PROVIDERS[p.provider] ? p.provider : s.provider || 'claude';
    const next = { ...s, provider: prov, models: { ...(s.models || {}) }, bases: { ...(s.bases || {}) } };
    if (typeof p.model === 'string') next.models[prov] = p.model.trim().slice(0, 100);
    if (typeof p.base === 'string') next.bases[prov] = p.base.trim().slice(0, 300);
    if ('echoToGame' in p) next.echoToGame = !!p.echoToGame;
    if (typeof p.key === 'string') saveSecret('aiKey-' + prov, cleanKey(p.key));
    writeStore({ ai: next });
    if (convo.provider !== prov) resetConvo();
    return true;
  });

  // ---------- game bridge (local web server the Bridge mod talks to) ----------
  const games = new Map(); // instanceId -> { token, status, seen, jobs: [], waiter, pending: Map }
  let port = 0;
  const logs = new Map(); // instanceId -> last lines of the game log
  const BRIDGE_DIR = path.join(__dirname, 'bridge');

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      const token = req.headers['x-bridge-token'];
      const game = [...games.entries()].find(([, g]) => g.token === token);
      const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (!game) return reply(403, { error: 'unknown game' });
      const [instanceId, g] = game;
      let data = {}; try { data = JSON.parse(body || '{}'); } catch {}
      if (data.status) { g.status = data.status; }
      const wasSeen = g.seen; g.seen = Date.now();
      if (!wasSeen) send('ai:game', gameList());
      if (req.url === '/poll') {
        if (g.jobs.length) return reply(200, { jobs: g.jobs.splice(0) });
        if (g.waiter) { try { g.waiter(); } catch {} }
        const timer = setTimeout(() => { if (g.waiter === waiter) g.waiter = null; reply(200, { jobs: g.jobs.splice(0) }); }, 15000);
        const waiter = () => { clearTimeout(timer); g.waiter = null; reply(200, { jobs: g.jobs.splice(0) }); };
        g.waiter = waiter;
        res.on('close', () => { if (g.waiter === waiter) { clearTimeout(timer); g.waiter = null; } });
        return;
      }
      if (req.url === '/ask') { ask(String(data.text || '').slice(0, 4000), { from: 'game', instanceId }); return reply(200, { ok: true }); }
      if (req.url === '/result') { const p = g.pending.get(data.id); if (p) { g.pending.delete(data.id); p(data); } return reply(200, { ok: true }); }
      reply(404, {});
    });
  });
  server.listen(0, '127.0.0.1', () => { port = server.address().port; });

  function pushJob(g, job) { g.jobs.push(job); if (g.waiter) g.waiter(); }
  function liveGame(instanceId) {
    const live = [...games.entries()].filter(([, g]) => Date.now() - g.seen < 40000);
    if (instanceId) return live.find(([id]) => id === instanceId) || null;
    return live.sort((a, b) => b[1].seen - a[1].seen)[0] || null;
  }
  function gameList() { return [...games.entries()].filter(([, g]) => Date.now() - g.seen < 40000).map(([id, g]) => ({ instanceId: id, status: g.status })); }
  function gameJob(instanceId, job, timeoutMs = 60000) {
    const live = liveGame(instanceId);
    if (!live) throw new Error('Minecraft isn\'t connected. Launch a Fabric or Quilt instance from BlazeMind and load into a world (the BlazeMind Bridge mod is added for you).');
    const [, g] = live;
    const id = crypto.randomBytes(6).toString('hex');
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { g.pending.delete(id); reject(new Error('Minecraft didn\'t answer in time (is the game paused on a loading screen?).')); }, timeoutMs);
      g.pending.set(id, r => { clearTimeout(t); resolve(r); });
      pushJob(g, { ...job, id });
    });
  }
  function sayInGame(text, instanceId) {
    const live = liveGame(instanceId); if (!live) return;
    const lines = String(text).replace(/\*\*/g, '').split('\n').map(s => s.trim()).filter(Boolean);
    for (const l of lines.slice(0, 20)) pushJob(live[1], { type: 'say', text: l.slice(0, 400), id: crypto.randomBytes(4).toString('hex') });
  }

  // Called by main.js just before Minecraft starts
  async function prepareLaunch(inst) {
    const token = crypto.randomBytes(16).toString('hex');
    games.set(inst.id, { token, status: null, seen: 0, jobs: [], waiter: null, pending: new Map() });
    const dir = instDir(inst.id);
    await fsp.writeFile(path.join(dir, 'blazemind-bridge.json'), JSON.stringify({ port, token }));
    if (inst.loader !== 'fabric' && inst.loader !== 'quilt') return { bridge: false, why: 'The in-game AI needs a Fabric or Quilt instance.' };
    const jar = path.join(BRIDGE_DIR, `blazemind-bridge-${inst.mcVersion}.jar`);
    if (!fs.existsSync(jar)) return { bridge: false, why: `The in-game AI isn't available for Minecraft ${inst.mcVersion} yet. Supported: ${bridgeVersions().join(', ')}` };
    await fsp.mkdir(path.join(dir, 'mods'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'mods', 'blazemind-bridge.jar'), await fsp.readFile(jar));
    // The Bridge uses Fabric API
    const hasApi = (inst.mods || []).some(m => m.slug === 'fabric-api' || m.projectId === 'P7dR8mSH' || /fabric-api/i.test(m.file || ''))
      || (await fsp.readdir(path.join(dir, 'mods')).catch(() => [])).some(f => /^fabric-api/i.test(f));
    if (!hasApi && inst.loader === 'fabric') {
      try { inst.mods ||= []; await installModrinth(inst, 'fabric-api'); await writeInstance(inst); } catch (e) { return { bridge: true, why: 'Couldn\'t add Fabric API (offline?). The in-game AI needs it.' }; }
    }
    if (!hasApi && inst.loader === 'quilt') {
      try { inst.mods ||= []; await installModrinth(inst, 'qsl'); await writeInstance(inst); } catch {}
    }
    return { bridge: true };
  }
  function bridgeVersions() { try { return fs.readdirSync(BRIDGE_DIR).map(f => (f.match(/^blazemind-bridge-(.+)\.jar$/) || [])[1]).filter(Boolean); } catch { return []; } }
  function onLog(data) {
    if (!data?.id) return;
    const l = logs.get(data.id) || []; l.push(String(data.line).slice(0, 1000)); if (l.length > 400) l.splice(0, l.length - 400); logs.set(data.id, l);
  }
  function onClosed(id) { const g = games.get(id); if (g) g.seen = 0; send('ai:game', gameList()); }
  ipcMain.handle('ai:games', () => gameList());

  // ---------- tools the AI can use ----------
  const safeJoin = (base, rel) => {
    const p = path.resolve(base, String(rel || '').replace(/^[/\\]+/, ''));
    if (p !== path.resolve(base) && !p.startsWith(path.resolve(base) + path.sep)) throw new Error('That path is outside the allowed folder.');
    return p;
  };
  const packId = s => String(s || 'pack').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'pack';
  async function writeTree(root, files) {
    let n = 0;
    for (const [rel, content] of Object.entries(files || {})) {
      if (/\.(jar|exe|bat|cmd|sh|dll|so|dylib|ps1)$/i.test(rel)) throw new Error(`Not allowed: ${rel}`);
      const f = safeJoin(root, rel);
      await fsp.mkdir(path.dirname(f), { recursive: true });
      await fsp.writeFile(f, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
      n++;
    }
    return n;
  }
  // Tiny PNG encoder so the AI can paint textures
  function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
  function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
  function pngFromRows(rows) {
    const grid = rows.map(r => String(r).trim().split(/[\s,]+/).filter(Boolean));
    const h = grid.length, w = Math.max(...grid.map(r => r.length));
    if (!h || !w || w > 512 || h > 512) throw new Error('Textures must be 1–512 pixels wide and tall.');
    const raw = Buffer.alloc(h * (w * 4 + 1));
    grid.forEach((row, y) => {
      raw[y * (w * 4 + 1)] = 0;
      for (let x = 0; x < w; x++) {
        const t = (row[x] || '-').replace('#', '');
        const o = y * (w * 4 + 1) + 1 + x * 4;
        if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(t)) { raw[o] = parseInt(t.slice(0, 2), 16); raw[o + 1] = parseInt(t.slice(2, 4), 16); raw[o + 2] = parseInt(t.slice(4, 6), 16); raw[o + 3] = t.length === 8 ? parseInt(t.slice(6, 8), 16) : 255; }
      }
    });
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  }

  const TOOLS = [
    { name: 'game_status', description: 'See whether Minecraft is running with the BlazeMind Bridge and get the player\'s position, dimension, game mode, health, held item and world.', input_schema: { type: 'object', properties: {} },
      run: async () => ({ games: gameList(), bridgeVersions: bridgeVersions() }) },
    { name: 'run_commands', description: 'Run Minecraft commands in the running game instantly (no restart). In singleplayer they run with full operator power even if cheats are off; in multiplayer they are sent as the player (needs op). Use for give, summon, effect, tp, time, weather, gamerule, fill, setblock, clone, place, execute, enchant, attribute, item, data, scoreboard, title, particle, playsound, function, reload and anything else. Leave out the leading slash or keep it. Build structures with many fill/setblock commands. Uses the syntax for the game\'s version.',
      input_schema: { type: 'object', properties: { commands: { type: 'array', items: { type: 'string' }, description: 'Commands to run in order (max 300).' }, instanceId: { type: 'string', description: 'Optional: which running instance.' } }, required: ['commands'] },
      run: async ({ commands, instanceId }) => {
        const list = (Array.isArray(commands) ? commands : [commands]).map(c => String(c).replace(/[\r\n]/g, ' ').trim()).filter(Boolean).slice(0, 300);
        const r = await gameJob(instanceId, { type: 'commands', commands: list }, 120000);
        return r.results || r;
      } },
    { name: 'install_datapack', description: 'Add a data pack to the world the player is in and load it right away with /reload (no restart). Use this for new crafting recipes, loot tables, advancements, custom enchantments, functions that run every tick (tick.json tag), custom dimensions/biomes (those need a world rejoin), damage types, trims and more. Paths are inside the pack, e.g. "data/blaze/function/hello.mcfunction" (1.21+ uses singular folder names like function/recipe/loot_table/advancement; older versions use plural). pack.mcmeta is made for you if you leave it out.',
      input_schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, files: { type: 'object', additionalProperties: { type: 'string' }, description: 'path → file text' }, instanceId: { type: 'string' } }, required: ['name', 'files'] },
      run: async ({ name, description, files, instanceId }) => {
        const live = liveGame(instanceId);
        if (!live) throw new Error('Load into a singleplayer world first.');
        const [iid, g] = live;
        const world = g.status?.worldDir;
        if (!world) throw new Error('Data packs can only be added in singleplayer. On a server, use the server tools.');
        const wdir = safeJoin(instDir(iid), path.relative(instDir(iid), world));
        const inst = await readInstance(iid);
        const id = packId(name), root = path.join(wdir, 'datapacks', id);
        const all = { ...files };
        if (!all['pack.mcmeta']) all['pack.mcmeta'] = JSON.stringify({ pack: { pack_format: packFormat(inst.mcVersion), description: String(description || name) } }, null, 2);
        const n = await writeTree(root, all);
        const r = await gameJob(iid, { type: 'commands', commands: ['reload', `datapack enable "file/${id}"`] });
        return { wrote: n, pack: id, reload: r.results };
      } },
    { name: 'install_resourcepack', description: 'Make or update a resource pack in the instance and turn it on in the running game right away (resources reload, no restart). Retexture items/blocks/mobs, change sounds.json, languages (rename things), models, fonts, GUI. Paint textures with "textures": each one has a path like "assets/minecraft/textures/item/diamond_sword.png" and "rows": one string per pixel row of space-separated hex colors (RRGGBB or RRGGBBAA, "-" = transparent). Items and blocks are 16x16.',
      input_schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, files: { type: 'object', additionalProperties: { type: 'string' } }, textures: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, rows: { type: 'array', items: { type: 'string' } } }, required: ['path', 'rows'] } }, instanceId: { type: 'string' } }, required: ['name'] },
      run: async ({ name, description, files, textures, instanceId }) => {
        const live = liveGame(instanceId);
        const iid = instanceId || live?.[0];
        if (!iid) throw new Error('Say which instance (instanceId) or start the game first.');
        const inst = await readInstance(iid);
        const id = packId(name), root = path.join(instDir(iid), 'resourcepacks', id);
        const all = { ...(files || {}) };
        if (!all['pack.mcmeta'] && !fs.existsSync(path.join(root, 'pack.mcmeta'))) all['pack.mcmeta'] = JSON.stringify({ pack: { pack_format: rpFormat(inst.mcVersion), description: String(description || name) } }, null, 2);
        let n = await writeTree(root, all);
        for (const t of textures || []) {
          if (!/\.png$/i.test(t.path)) throw new Error('Texture paths must end in .png');
          const f = safeJoin(root, t.path); await fsp.mkdir(path.dirname(f), { recursive: true }); await fsp.writeFile(f, pngFromRows(t.rows)); n++;
        }
        let applied = 'Saved. It turns on next time the game starts.';
        if (live && live[0] === iid) { await gameJob(iid, { type: 'enable_pack', pack: `file/${id}` }, 120000); applied = 'Turned on and reloaded in the running game.'; }
        else { await addToOptions(iid, `file/${id}`); }
        return { wrote: n, pack: id, applied };
      } },
    { name: 'list_instances', description: 'List the player\'s Minecraft instances (id, name, version, loader, mods).', input_schema: { type: 'object', properties: {} },
      run: async () => (await invoke('instances:list')).map(i => ({ id: i.id, name: i.name, mcVersion: i.mcVersion, loader: i.loader, mods: (i.mods || []).map(m => ({ title: m.title, file: m.file, type: m.type || 'mod', off: !!m.disabled })).slice(0, 150), running: d.running.has(i.id) })) },
    { name: 'create_instance', description: 'Make a new instance (a separate Minecraft setup). loader: vanilla, fabric, quilt, forge or neoforge. Pick fabric for the in-game AI.', input_schema: { type: 'object', properties: { name: { type: 'string' }, mcVersion: { type: 'string' }, loader: { type: 'string', enum: ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'] }, icon: { type: 'string', enum: ['grass', 'stone', 'diamond', 'gold', 'tnt', 'obsidian', 'netherrack', 'amethyst'] } }, required: ['name', 'mcVersion', 'loader'] },
      run: async a => { const i = await invoke('instances:create', { name: String(a.name).slice(0, 40), mcVersion: a.mcVersion, loader: a.loader, icon: a.icon }); send('instances:changed', i.id); return { id: i.id, name: i.name }; } },
    { name: 'search_content', description: 'Search Modrinth for mods, modpacks, resource packs, shaders or data packs that work with an instance.', input_schema: { type: 'object', properties: { query: { type: 'string' }, type: { type: 'string', enum: ['mod', 'modpack', 'resourcepack', 'texturepack', 'shader', 'datapack'] }, instanceId: { type: 'string' } }, required: ['query'] },
      run: async ({ query, type = 'mod', instanceId }) => {
        const inst = instanceId ? await readInstance(instanceId) : null;
        const r = await invoke('mods:search', { source: 'modrinth', query, type, mcVersion: inst?.mcVersion, loader: inst?.loader, limit: 12 });
        return (r.hits || []).slice(0, 12).map(h => ({ projectId: h.id, title: h.title, description: String(h.description || '').slice(0, 160), downloads: h.downloads }));
      } },
    { name: 'install_content', description: 'Install a mod, resource pack, shader or data pack from Modrinth into an instance (required dependencies come too). Mods need a game restart to load; say so.', input_schema: { type: 'object', properties: { instanceId: { type: 'string' }, projectId: { type: 'string' }, type: { type: 'string', enum: ['mod', 'resourcepack', 'shader', 'datapack'] } }, required: ['instanceId', 'projectId'] },
      run: async ({ instanceId, projectId, type = 'mod' }) => { const r = await invoke('mods:install', { instanceId, source: 'modrinth', projectId, type }); send('instances:changed', instanceId); return { added: (r.added || []).map(a => a.title || a) }; } },
    { name: 'install_modpack', description: 'Install a Modrinth modpack as a brand new instance.', input_schema: { type: 'object', properties: { projectId: { type: 'string' }, title: { type: 'string' } }, required: ['projectId'] },
      run: async ({ projectId, title }) => { const r = await invoke('modpack:install', { source: 'modrinth', projectId, title }); send('instances:changed', r?.instance?.id); return { id: r?.instance?.id, name: r?.instance?.name, skipped: r?.skipped }; } },
    { name: 'launch_instance', description: 'Start Minecraft with an instance.', input_schema: { type: 'object', properties: { instanceId: { type: 'string' } }, required: ['instanceId'] },
      run: async ({ instanceId }) => { await invoke('game:launch', instanceId); return { started: true }; } },
    { name: 'read_game_log', description: 'Read the end of the game log (to explain crashes or errors).', input_schema: { type: 'object', properties: { instanceId: { type: 'string' }, lines: { type: 'number' } }, required: ['instanceId'] },
      run: async ({ instanceId, lines = 80 }) => {
        let l = logs.get(instanceId);
        if (!l?.length) { try { l = (await fsp.readFile(path.join(instDir(instanceId), 'logs', 'latest.log'), 'utf8')).split('\n'); } catch { l = []; } }
        return l.slice(-Math.min(300, Math.max(10, lines))).join('\n');
      } },
    { name: 'list_files', description: 'List files in an instance folder (configs, worlds, resourcepacks, etc.).', input_schema: { type: 'object', properties: { instanceId: { type: 'string' }, dir: { type: 'string' } }, required: ['instanceId'] },
      run: async ({ instanceId, dir = '' }) => { const p = safeJoin(instDir(instanceId), dir); return (await fsp.readdir(p, { withFileTypes: true })).slice(0, 300).map(e => e.name + (e.isDirectory() ? '/' : '')); } },
    { name: 'read_file', description: 'Read a text file in an instance folder (e.g. config/sodium-options.json, options.txt).', input_schema: { type: 'object', properties: { instanceId: { type: 'string' }, path: { type: 'string' } }, required: ['instanceId', 'path'] },
      run: async ({ instanceId, path: rel }) => { const f = safeJoin(instDir(instanceId), rel); const st = await fsp.stat(f); if (st.size > 400000) throw new Error('File is too big to read.'); return fsp.readFile(f, 'utf8'); } },
    { name: 'write_file', description: 'Create or change a text file in an instance folder, like a mod config. Most mod configs only take effect after a restart.', input_schema: { type: 'object', properties: { instanceId: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' } }, required: ['instanceId', 'path', 'content'] },
      run: async ({ instanceId, path: rel, content }) => { await writeTree(instDir(instanceId), { [rel]: String(content) }); return { saved: rel }; } },
    { name: 'repair_instance', description: 'Repair an instance that won\'t start or crashes: re-checks and re-downloads broken mods, game files and the mod loader. Optionally resets video settings (fixes black screens). Never touches worlds. The game must be closed.', input_schema: { type: 'object', properties: { instanceId: { type: 'string' }, resetVideoSettings: { type: 'boolean' } }, required: ['instanceId'] },
      run: async ({ instanceId, resetVideoSettings }) => invoke('repair:instance', { id: instanceId, options: !!resetVideoSettings }) },
    { name: 'remove_content', description: 'Remove an installed mod or pack from an instance by its file name (see list_instances / read the mods folder). Needs a restart if the game is running.', input_schema: { type: 'object', properties: { instanceId: { type: 'string' }, file: { type: 'string' } }, required: ['instanceId', 'file'] },
      run: async ({ instanceId, file }) => { await invoke('mods:remove', { instanceId, file }); send('instances:changed', instanceId); return { removed: file }; } },
    { name: 'list_worlds', description: 'List the saved worlds in an instance.', input_schema: { type: 'object', properties: { instanceId: { type: 'string' } }, required: ['instanceId'] },
      run: async ({ instanceId }) => (await invoke('worlds:list', instanceId)).map(w => ({ name: w.name, sizeMB: Math.round(w.size / 1048576), lastPlayed: new Date(w.played).toISOString() })) },
    { name: 'list_servers', description: 'List servers hosted by BlazeMind on this PC.', input_schema: { type: 'object', properties: {} },
      run: async () => (await invoke('servers:list')).map(s => ({ id: s.id, name: s.name, mcVersion: s.mcVersion, loader: s.loader, status: s.status, players: s.players })) },
    { name: 'server_command', description: 'Run a console command on a running BlazeMind-hosted server.', input_schema: { type: 'object', properties: { serverId: { type: 'string' }, command: { type: 'string' } }, required: ['serverId', 'command'] },
      run: async ({ serverId, command }) => ({ sent: await invoke('servers:command', { id: serverId, cmd: String(command).replace(/^\//, '') }) }) },
  ];
  function rpFormat(mc) {
    const t = [['1.21.7', 64], ['1.21.6', 63], ['1.21.5', 55], ['1.21.4', 46], ['1.21.2', 42], ['1.21', 34], ['1.20.5', 32], ['1.20.3', 22], ['1.20.2', 18], ['1.20', 15], ['1.19.4', 13], ['1.19.3', 12], ['1.19', 9], ['1.18', 8], ['1.17', 7], ['1.16.2', 6], ['1.15', 5], ['1.13', 4]];
    for (const [v, f] of t) if (d.newerOrSame(mc, v)) return f;
    return 4;
  }
  async function addToOptions(iid, packName) {
    const f = path.join(instDir(iid), 'options.txt');
    let txt = ''; try { txt = await fsp.readFile(f, 'utf8'); } catch {}
    const m = txt.match(/^resourcePacks:(.*)$/m);
    let list = []; try { list = m ? JSON.parse(m[1]) : ['vanilla']; } catch { list = ['vanilla']; }
    if (!list.includes(packName)) list.push(packName);
    const line = `resourcePacks:${JSON.stringify(list)}`;
    txt = m ? txt.replace(/^resourcePacks:.*$/m, line) : txt + (txt && !txt.endsWith('\n') ? '\n' : '') + line + '\n';
    await fsp.writeFile(f, txt);
  }
  const TOOL_MAP = Object.fromEntries(TOOLS.map(t => [t.name, t]));

  const SYSTEM = `You are BlazeMind, the AI built into the BlazeMind Minecraft launcher. You can act inside the running game and in the launcher.
- Do what the player asks right away with your tools; don't just explain how. Prefer things that work without restarting: commands (run_commands), data packs (install_datapack, then they load with /reload) and resource packs (install_resourcepack, reloaded live).
- For big builds, use many fill/setblock commands relative to the player (~ ~ ~) or absolute coordinates from game_status.
- Mods and loader changes only load after a restart. Install them, then tell the player to restart.
- Check game_status first when you need the player's position, version or world.
- Use command and data pack syntax for the instance's Minecraft version.
- When the player is in-game, keep replies short (1–3 lines) because they show in the chat box. Use plain text, no markdown tables.
- Never delete worlds or instances unless the player clearly asks.`;

  // ---------- conversation ----------
  let convo = { provider: null, messages: [] };
  function resetConvo() { convo = { provider: cfg().provider, messages: [] }; send('ai:event', { type: 'reset' }); }
  ipcMain.handle('ai:reset', () => { resetConvo(); return true; });
  let chain = Promise.resolve();
  let busy = 0;
  function ask(text, origin = { from: 'launcher' }) {
    if (!text.trim()) return;
    send('ai:event', { type: 'user', text, from: origin.from });
    busy++; send('ai:event', { type: 'busy', busy });
    if (origin.from === 'game') sayInGame('…thinking', origin.instanceId);
    chain = chain.then(() => turn(text, origin)).catch(e => {
      const msg = friendlyError(e);
      send('ai:event', { type: 'error', text: msg });
      if (origin.from === 'game') sayInGame('⚠ ' + msg, origin.instanceId);
    }).finally(() => { busy--; send('ai:event', { type: 'busy', busy }); });
  }
  ipcMain.handle('ai:ask', (_e, text) => { ask(String(text || '').slice(0, 8000)); return true; });

  function friendlyError(e) {
    const s = String(e?.message || e);
    if (e?.blaze) return s;
    if (e?.status === 401) return `The AI service rejected the key (401). It said: ${apiMessage(e)}`;
    if (e?.status === 403) return `The AI service refused (403): ${apiMessage(e)}`;
    if (e?.status === 429) return 'The AI service says you\'ve hit a limit or run out of credit. Wait a bit or check your account.';
    if (/ECONNREFUSED.*11434|11434/.test(s)) return 'Ollama isn\'t running. Start Ollama, or pick another AI in Settings → AI.';
    if (/fetch failed|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|Connection error/i.test(s)) return 'Can\'t reach the AI service. Are you offline? (Ollama works without internet.)';
    return (e?.status ? `Error ${e.status}: ` : '') + apiMessage(e);
  }
  // Pull the service's own explanation out of an SDK or HTTP error
  function apiMessage(e) {
    const m = e?.error?.error?.message || e?.error?.message || e?.message || String(e);
    return String(m).replace(/^\d{3}\s+/, '').slice(0, 400);
  }

  // Settings → AI → "Check key": a free call that only lists models
  ipcMain.handle('ai:checkKey', async () => {
    const c = cfg(), key = loadSecret('aiKey-' + c.provider) || '';
    if (PROVIDERS[c.provider].needsKey && !key) return { ok: false, text: 'No key saved for this AI yet.' };
    try {
      if (c.provider === 'claude') {
        if (!/^sk-ant-api/.test(key)) return { ok: false, text: keyShapeHint(key) };
        const sdk = require('@anthropic-ai/sdk'); const Anthropic = sdk.default || sdk;
        const client = new Anthropic({ apiKey: key, authToken: null });
        const models = []; for await (const m of client.models.list({ limit: 100 })) models.push(m.id);
        const has = models.includes(c.model);
        return { ok: true, text: `Key works. ${has ? `Model ${c.model} is available.` : `But your account doesn't list "${c.model}". Available: ${models.slice(0, 8).join(', ')}`}` };
      }
      const res = await fetch(c.base.replace(/\/+$/, '') + '/models', { headers: key ? { Authorization: `Bearer ${key}` } : {} });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, text: `Error ${res.status}: ${j?.error?.message || 'the service refused'}` };
      const ids = (j.data || []).map(m => m.id);
      return { ok: true, text: `Key works.${ids.length && !ids.includes(c.model) ? ` "${c.model}" isn't in your list. Some available: ${ids.slice(0, 8).join(', ')}` : ''}` };
    } catch (e) { return { ok: false, text: friendlyError(e) }; }
  });
  function keyShapeHint(key) {
    if (/^sk-ant-oat/.test(key)) return 'That\'s a Claude subscription login token (sk-ant-oat…), not an API key. Make an API key at console.anthropic.com → API keys (it starts with sk-ant-api).';
    if (/^sk-ant-admin/.test(key)) return 'That\'s an Admin key. Make a normal API key at console.anthropic.com → API keys (it starts with sk-ant-api).';
    if (/^sk-(proj-)?[A-Za-z0-9]/.test(key) && !/^sk-ant/.test(key)) return 'That looks like an OpenAI (ChatGPT) key. Pick "ChatGPT (OpenAI)" as the AI service, or make a Claude key at console.anthropic.com.';
    if (/^AIza/.test(key)) return 'That looks like a Google Gemini key. Pick "Gemini (Google)" as the AI service.';
    return 'That doesn\'t look like a Claude API key. Claude keys start with sk-ant-api and come from console.anthropic.com → API keys.';
  }

  async function runTool(name, input) {
    const t = TOOL_MAP[name];
    send('ai:event', { type: 'tool', name, input });
    if (!t) return { error: true, text: `No tool named ${name}` };
    try {
      const out = await t.run(input || {});
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      send('ai:event', { type: 'tool-done', name, ok: true, text: text.slice(0, 600) });
      return { error: false, text: text.slice(0, 30000) };
    } catch (e) {
      send('ai:event', { type: 'tool-done', name, ok: false, text: String(e.message || e) });
      return { error: true, text: String(e.message || e) };
    }
  }

  function context(origin) {
    const games = gameList();
    return `[BlazeMind context] Asked from: ${origin.from === 'game' ? 'inside Minecraft' : 'the launcher'}. Running games: ${games.length ? JSON.stringify(games) : 'none'}.`;
  }

  async function turn(text, origin) {
    const c = cfg();
    if (convo.provider !== c.provider) convo = { provider: c.provider, messages: [] };
    const key = loadSecret('aiKey-' + c.provider) || '';
    if (PROVIDERS[c.provider].needsKey && !key) throw new Error(`Add your ${PROVIDERS[c.provider].name} key in Settings → AI first.`);
    const userText = `${context(origin)}\n\n${text}`;
    const reply = c.provider === 'claude' ? await turnClaude(userText, c, key) : await turnOpenAI(userText, c, key);
    if (reply) {
      send('ai:event', { type: 'assistant', text: reply });
      if (origin.from === 'game' || (c.echoToGame && liveGame())) sayInGame(reply, origin.instanceId);
    }
  }

  // Claude, through the official Anthropic SDK
  async function turnClaude(userText, c, key) {
    const sdk = require('@anthropic-ai/sdk');
    const Anthropic = sdk.default || sdk;
    const client = new Anthropic({ apiKey: key, authToken: null });
    if (!/^sk-ant-api/.test(key)) throw Object.assign(new Error(keyShapeHint(key)), { blaze: true });
    const start = convo.messages.length;
    convo.messages.push({ role: 'user', content: userText });
    const tools = TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
    const current = /^claude-(opus|sonnet|haiku|fable)-5/.test(c.model);
    let fallbackOk = /^claude-(opus-5-5|sonnet-5-5|fable-5-[12]|opus-5$)/.test(c.model);
    let final = '';
    for (let step = 0; step < 30; step++) {
      const params = { model: c.model, max_tokens: 16000, system: SYSTEM, tools, messages: convo.messages, ...(current ? { output_config: { effort: 'medium' } } : {}) };
      let r;
      try {
        try {
          r = fallbackOk
            ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
            : await client.messages.create(params);
        } catch (e) {
          // Some accounts don't have the fallback option yet: try once more without it
          if (fallbackOk && e instanceof Anthropic.BadRequestError && /fallback|beta/i.test(apiMessage(e))) { fallbackOk = false; r = await client.messages.create(params); }
          else throw e;
        }
      } catch (e) {
        convo.messages.length = start;
        if (e instanceof Anthropic.AuthenticationError) throw Object.assign(new Error(`Anthropic rejected the key: ${apiMessage(e)}. Check it in Settings → AI → Check key (make sure you copied the whole key, and that it wasn't deleted).`), { blaze: true });
        if (e instanceof Anthropic.PermissionDeniedError) throw Object.assign(new Error(`Anthropic refused: ${apiMessage(e)}`), { blaze: true });
        if (e instanceof Anthropic.RateLimitError) throw Object.assign(new Error('Claude is rate-limited right now. Try again in a moment.'), { blaze: true });
        if (e instanceof Anthropic.NotFoundError) throw Object.assign(new Error(`Claude doesn't know the model "${c.model}". Change it in Settings → AI.`), { blaze: true });
        if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(apiMessage(e))) throw Object.assign(new Error('Your Anthropic account has no credit. Add some at console.anthropic.com → Billing.'), { blaze: true });
        throw e;
      }
      convo.messages.push({ role: 'assistant', content: r.content });
      const texts = r.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (texts && r.stop_reason === 'tool_use') send('ai:event', { type: 'thought', text: texts });
      if (r.stop_reason === 'refusal') return (texts ? texts + '\n' : '') + 'Claude declined that request.';
      if (r.stop_reason !== 'tool_use') { final = texts; break; }
      const results = [];
      for (const b of r.content.filter(b => b.type === 'tool_use')) {
        const out = await runTool(b.name, b.input);
        results.push({ type: 'tool_result', tool_use_id: b.id, content: out.text, is_error: out.error });
      }
      convo.messages.push({ role: 'user', content: results });
    }
    trim();
    return final;
  }

  // ChatGPT, Gemini, Ollama and other OpenAI-compatible servers
  async function turnOpenAI(userText, c, key) {
    if (!c.base) throw new Error('Set the server address in Settings → AI.');
    const start = convo.messages.length;
    convo.messages.push({ role: 'user', content: userText });
    const tools = TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    let final = '';
    for (let step = 0; step < 30; step++) {
      const res = await fetch(c.base.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: c.model, messages: [{ role: 'system', content: SYSTEM }, ...convo.messages], tools }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { convo.messages.length = start; throw Object.assign(new Error(j?.error?.message || `The AI service answered ${res.status}.`), { status: res.status }); }
      const msg = j.choices?.[0]?.message;
      if (!msg) throw new Error('The AI sent an empty answer.');
      convo.messages.push({ role: 'assistant', content: msg.content || '', ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
      if (!msg.tool_calls?.length) { final = String(msg.content || '').trim(); break; }
      if (msg.content) send('ai:event', { type: 'thought', text: msg.content });
      for (const call of msg.tool_calls) {
        let args = {}; try { args = JSON.parse(call.function?.arguments || '{}'); } catch {}
        const out = await runTool(call.function?.name, args);
        convo.messages.push({ role: 'tool', tool_call_id: call.id, content: (out.error ? 'ERROR: ' : '') + out.text });
      }
    }
    trim();
    return final;
  }
  // Keep long chats from growing forever (drop the oldest whole exchanges)
  function trim() {
    while (convo.messages.length > 80) {
      const next = convo.messages.findIndex((m, i) => i > 0 && m.role === 'user' && typeof m.content === 'string');
      if (next <= 0) break;
      convo.messages.splice(0, next);
    }
  }

  return { prepareLaunch, onLog, onClosed, bridgeVersions, ask };
};
module.exports.PROVIDERS = PROVIDERS;
