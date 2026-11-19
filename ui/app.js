// BlazeMind interface
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errText = e => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const LOADERS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
const TYPE_NAMES = { mod: 'Mods', resourcepack: 'Resource packs', shader: 'Shaders', datapack: 'Data packs' };

const S = { user: null, instances: [], page: 'home', inst: null, tab: 'content', running: new Set(), status: {}, logs: {}, online: true, games: [], aiBusy: 0 };

function toast(text, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = text;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 4200);
}
function modal(html) { $('#modal-card').innerHTML = html; $('#modal').classList.remove('hidden'); return $('#modal-card'); }
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
const ago = t => { if (!t) return 'never played'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const hours = ms => ms ? `${Math.round(ms / 360000) / 10} h played` : '';

// ---------- start ----------
$('#login-flame').innerHTML = Art.flame(84);
$('#rail-logo').innerHTML = Art.flame(36);
$('#hello-flame').innerHTML = Art.flame(46);

async function boot() {
  try { S.user = await lab.restore(); } catch { S.user = null; }
  if (!S.user) { $('#login').classList.remove('hidden'); return; }
  enterApp();
}
$('#btn-login').onclick = async () => {
  const b = $('#btn-login'); b.disabled = true; $('#login-err').classList.add('hidden');
  try { S.user = await lab.login(); $('#login').classList.add('hidden'); enterApp(); }
  catch (e) { $('#login-err').textContent = errText(e); $('#login-err').classList.remove('hidden'); }
  finally { b.disabled = false; }
};
async function enterApp() {
  $('#app').classList.remove('hidden');
  const face = $('#me-face');
  face.onerror = () => { face.onerror = null; face.src = 'icon.png'; };
  face.src = S.user.skin || 'icon.png'; face.title = S.user.name + (S.user.offline ? ' (offline)' : '');
  await loadInstances();
  refreshNet(); setInterval(refreshNet, 15000);
  refreshMindHeader();
  S.games = await lab.ai.games(); renderGame();
  go('home');
}
async function refreshNet() {
  try { S.online = await lab.isOnline(); } catch { S.online = false; }
  $('#net').classList.toggle('off', !S.online);
  $('#net').title = S.online ? 'Online' : 'Offline: you can still play, create packs and use Ollama AI';
}
async function loadInstances() { S.instances = await lab.listInstances(); }
lab.onInstancesChanged(async () => { await loadInstances(); if (['home', 'library'].includes(S.page)) go(S.page); if (S.page === 'instance' && S.inst) openInstance(S.inst.id); });

// ---------- navigation ----------
$$('.rail-btn').forEach(b => b.onclick = () => go(b.dataset.page));
$('#me-face').onclick = () => go('settings');
function go(page) {
  S.page = page;
  $$('.rail-btn').forEach(b => b.classList.toggle('on', b.dataset.page === page || (page === 'instance' && b.dataset.page === 'library')));
  ({ home: pageHome, library: pageLibrary, discover: pageDiscover, create: pageCreate, settings: pageSettings })[page]?.();
}
const P = () => $('#page');

// ---------- home ----------
const IDEAS = ['Build me a small castle where I\'m standing', 'Make a horror modpack for 1.20.1', 'Give me a flaming netherite sword', 'Paint the diamond a deep red color', 'Make it night with a thunderstorm', 'Add a recipe: 9 rotten flesh → 1 leather', 'Why did my game crash?', 'Install Sodium and Iris with a nice shader'];
function pageHome() {
  const last = [...S.instances].sort((a, b) => (b.lastPlayed || b.created || 0) - (a.lastPlayed || a.created || 0))[0];
  P().innerHTML = `
    <section class="hero">
      ${last ? Art.tile(last, 92) : `<div>${Art.flame(92)}</div>`}
      <div class="grow">
        <h2>${last ? 'JUMP BACK IN' : 'WELCOME TO BLAZEMIND'}</h2>
        <h1>${last ? esc(last.name) : `Hi, ${esc(S.user.name)}`}</h1>
        <div class="dim">${last ? `Minecraft ${esc(last.mcVersion)} · ${LOADERS[last.loader] || last.loader} · ${ago(last.lastPlayed)}` : 'Make your first instance, or just ask the AI to set one up for you.'}</div>
      </div>
      ${last ? `<button class="btn hot big" id="h-play">${S.running.has(last.id) ? '■ Stop' : '▶ Play'}</button>` : '<button class="btn hot big" id="h-new">＋ New instance</button>'}
    </section>
    <form class="ask-big" id="h-ask"><span>${Art.flame(22)}</span><input id="h-q" placeholder="Ask BlazeMind to do anything… (e.g. “set up a Fabric 1.21.1 instance with shaders”)" autocomplete="off"><button class="btn hot">Go</button></form>
    <div class="ideas">${IDEAS.map(i => `<button class="idea">${esc(i)}</button>`).join('')}</div>
    <h3 class="section-title">YOUR INSTANCES</h3>
    <div class="grid">${S.instances.map(instCard).join('')}<div class="card new-card" id="h-new2">＋ New instance</div></div>`;
  $('#h-play') && ($('#h-play').onclick = () => playToggle(last.id));
  $('#h-new') && ($('#h-new').onclick = newInstance);
  $('#h-new2').onclick = newInstance;
  $('#h-ask').onsubmit = e => { e.preventDefault(); const q = $('#h-q').value.trim(); if (q) { askAI(q); $('#h-q').value = ''; } };
  $$('.idea').forEach(b => b.onclick = () => { $('#h-q').value = b.textContent; $('#h-q').focus(); });
  bindCards();
}
function instCard(i) {
  return `<div class="card inst" data-id="${esc(i.id)}">${Art.tile(i, 48)}<div style="min-width:0"><b>${esc(i.name)}</b><small>${esc(i.mcVersion)} · ${LOADERS[i.loader] || i.loader}${S.running.has(i.id) ? ' · <span class="live">● playing</span>' : ''}</small></div></div>`;
}
function bindCards() { $$('.inst[data-id]').forEach(c => c.onclick = () => openInstance(c.dataset.id)); }

// ---------- library ----------
function pageLibrary() {
  P().innerHTML = `
    <div class="page-head"><div class="grow"><h1>Library</h1><p>${S.instances.length} instance${S.instances.length === 1 ? '' : 's'}. Each one is its own Minecraft with its own mods and worlds.</p></div>
      <button class="btn" id="l-import">Import modpack file</button><button class="btn hot" id="l-new">＋ New instance</button></div>
    <div class="grid">${S.instances.map(instCard).join('') || '<p class="dim">Nothing here yet.</p>'}</div>`;
  $('#l-new').onclick = newInstance;
  $('#l-import').onclick = async () => { try { const r = await lab.importModpack(); if (r?.instance) { await loadInstances(); openInstance(r.instance.id); toast('Modpack imported', 'good'); } } catch (e) { toast(errText(e), 'bad'); } };
  bindCards();
}

async function newInstance() {
  const m = modal(`<h2>New instance</h2><p class="dim">Pick a Minecraft version and a mod loader. Fabric gets the in-game AI.</p>
    <label class="f"><span>Name</span><input id="n-name" maxlength="40" value="My World"></label>
    <label class="f"><span>Minecraft version</span><select id="n-ver"><option>Loading…</option></select></label>
    <label class="f"><span>Mod loader</span><div class="loaders" id="n-load">${Object.entries(LOADERS).map(([k, v]) => `<button type="button" data-l="${k}" ${k === 'fabric' ? 'class="on"' : ''}>${v}</button>`).join('')}</div></label>
    <p class="tiny" id="n-hint"></p>
    <div class="end"><button class="btn" id="n-cancel">Cancel</button><button class="btn hot" id="n-ok">Create</button></div>`);
  let loader = 'fabric';
  m.querySelector('#n-cancel').onclick = closeModal;
  m.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { if (b.disabled) return; loader = b.dataset.l; m.querySelectorAll('[data-l]').forEach(x => x.classList.toggle('on', x === b)); });
  const bridges = await lab.ai.bridgeVersions().catch(() => []);
  try {
    const vers = await lab.versions(false);
    const sel = m.querySelector('#n-ver');
    sel.innerHTML = vers.slice(0, 80).map(v => `<option value="${esc(v.id)}">${esc(v.id)}${bridges.includes(v.id) ? '  ✦ in-game AI' : ''}</option>`).join('');
    const best = vers.find(v => bridges.includes(v.id)); if (best) sel.value = best.id;
    const check = async () => {
      m.querySelector('#n-hint').textContent = 'Checking loaders…';
      let sup = {}; try { sup = await lab.loaders(sel.value); } catch {}
      m.querySelectorAll('[data-l]').forEach(b => { b.disabled = b.dataset.l !== 'vanilla' && !sup[b.dataset.l]; });
      if (m.querySelector(`[data-l="${loader}"]`).disabled) { loader = 'vanilla'; m.querySelectorAll('[data-l]').forEach(x => x.classList.toggle('on', x.dataset.l === 'vanilla')); }
      m.querySelector('#n-hint').textContent = bridges.includes(sel.value) ? 'This version supports the in-game AI on Fabric and Quilt.' : `In-game AI works on: ${bridges.join(', ') || 'coming soon'}. The launcher AI works on every version.`;
    };
    sel.onchange = check; check();
  } catch (e) { m.querySelector('#n-hint').textContent = 'Offline: can\'t list versions. ' + errText(e); }
  m.querySelector('#n-ok').onclick = async () => {
    const name = m.querySelector('#n-name').value.trim() || 'My World';
    try { const i = await lab.createInstance({ name, mcVersion: m.querySelector('#n-ver').value, loader }); closeModal(); await loadInstances(); openInstance(i.id); toast('Instance created', 'good'); }
    catch (e) { toast(errText(e), 'bad'); }
  };
}

// ---------- one instance ----------
async function openInstance(id) {
  S.page = 'instance';
  $$('.rail-btn').forEach(b => b.classList.toggle('on', b.dataset.page === 'library'));
  S.inst = await lab.getInstance(id);
  renderInstance();
}
function renderInstance() {
  const i = S.inst, run = S.running.has(i.id);
  const mods = i.mods || [];
  P().innerHTML = `
    <div class="inst-top">${Art.tile(i, 76)}
      <div><h1>${esc(i.name)}</h1><div class="chips"><span class="chip">Minecraft ${esc(i.mcVersion)}</span><span class="chip">${LOADERS[i.loader] || i.loader}</span><span class="chip">${mods.length} add-ons</span>${hours(i.playtime) ? `<span class="chip">${hours(i.playtime)}</span>` : ''}${S.games.some(g => g.instanceId === i.id) ? '<span class="chip ice">✦ AI connected</span>' : ''}</div></div>
      <button class="btn hot big play" id="i-play">${run ? '■ Stop' : '▶ Play'}</button>
    </div>
    <div class="status" id="i-status">${esc(S.status[i.id]?.stage && S.status[i.id].stage !== 'running' ? S.status[i.id].stage : run ? 'Playing. Type /ai in Minecraft to talk to BlazeMind.' : '')}</div>
    <div class="tabs">${[['content', 'Installed'], ['add', 'Add content'], ['log', 'Game log'], ['opts', 'Options']].map(([k, v]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-t="${k}">${v}</button>`).join('')}</div>
    <div id="i-body"></div>`;
  $('#i-play').onclick = () => playToggle(i.id);
  $$('.tab').forEach(t => t.onclick = () => { S.tab = t.dataset.t; renderInstance(); });
  ({ content: tabContent, add: tabAdd, log: tabLog, opts: tabOpts })[S.tab]();
}
function tabContent() {
  const i = S.inst, mods = i.mods || [];
  if (!mods.length) { $('#i-body').innerHTML = `<p class="dim">Nothing installed yet. Use <b>Add content</b>, or ask the Mind: “add the best performance mods”.</p>`; return; }
  const groups = {};
  for (const m of mods) (groups[m.type || 'mod'] ||= []).push(m);
  $('#i-body').innerHTML = Object.entries(groups).map(([t, list]) => `<h3 class="section-title">${(TYPE_NAMES[t] || t).toUpperCase()} · ${list.length}</h3><div class="list" style="margin-bottom:18px">${list.map(m => `
    <div class="item ${m.disabled ? 'off' : ''}">${m.icon ? `<img src="${esc(m.icon)}" alt="">` : '<div class="ph"></div>'}
      <div class="t"><b>${esc(m.title || m.file)}</b><small>${esc(m.version || m.file || '')}</small></div>
      <button class="btn sm" data-tog="${esc(m.file)}">${m.disabled ? 'Turn on' : 'Turn off'}</button>
      <button class="ghost" data-rm="${esc(m.file)}" title="Remove">✕</button></div>`).join('')}</div>`).join('');
  $$('[data-tog]').forEach(b => b.onclick = async () => { try { await lab.toggleMod({ instanceId: i.id, file: b.dataset.tog }); S.inst = await lab.getInstance(i.id); tabContent(); } catch (e) { toast(errText(e), 'bad'); } });
  $$('[data-rm]').forEach(b => b.onclick = async () => { try { await lab.removeMod({ instanceId: i.id, file: b.dataset.rm }); S.inst = await lab.getInstance(i.id); renderInstance(); } catch (e) { toast(errText(e), 'bad'); } });
}
let addType = 'mod';
function tabAdd() {
  const i = S.inst;
  $('#i-body').innerHTML = `<div class="row wrap" style="margin-bottom:14px"><div class="seg" id="a-type">${Object.entries(TYPE_NAMES).map(([k, v]) => `<button data-k="${k}" class="${addType === k ? 'on' : ''}">${v}</button>`).join('')}</div>
    <form class="row grow" id="a-form"><input id="a-q" placeholder="Search Modrinth…"><button class="btn hot">Search</button></form></div><div class="list" id="a-res"></div>`;
  $$('#a-type button').forEach(b => b.onclick = () => { addType = b.dataset.k; tabAdd(); });
  const search = async () => {
    $('#a-res').innerHTML = '<p class="dim">Searching…</p>';
    try {
      const r = await lab.searchMods({ source: 'modrinth', query: $('#a-q').value, mcVersion: i.mcVersion, loader: i.loader, type: addType });
      const have = new Set((S.inst.mods || []).map(m => String(m.projectId)));
      $('#a-res').innerHTML = (r.offline ? '<p class="tiny">Offline: showing mods saved on this computer. Installing needs internet.</p>' : '') + ((r.hits || []).map(h => `
        <div class="item">${h.icon ? `<img src="${esc(h.icon)}" alt="">` : '<div class="ph"></div>'}<div class="t"><b>${esc(h.title)}</b><small>${esc(h.description)}</small></div>
        <button class="btn sm ${have.has(String(h.id)) ? '' : 'hot'}" data-add="${esc(h.id)}" ${have.has(String(h.id)) ? 'disabled' : ''}>${have.has(String(h.id)) ? 'Installed' : 'Install'}</button></div>`).join('') || '<p class="dim">Nothing found for this version.</p>');
      $$('[data-add]').forEach(b => b.onclick = async () => {
        b.disabled = true; b.textContent = 'Installing…';
        try { const r = await lab.installMod({ instanceId: i.id, source: 'modrinth', projectId: b.dataset.add, type: addType }); S.inst = r.instance; b.textContent = 'Installed'; b.classList.remove('hot'); toast(`Added ${r.added.map(a => a.title).join(', ')}`, 'good'); }
        catch (e) { b.disabled = false; b.textContent = 'Install'; toast(errText(e), 'bad'); }
      });
    } catch (e) { $('#a-res').innerHTML = `<p class="err">${esc(errText(e))}</p>`; }
  };
  $('#a-form').onsubmit = e => { e.preventDefault(); search(); };
  search();
}
function tabLog() {
  const lines = S.logs[S.inst.id] || [];
  $('#i-body').innerHTML = `<div class="row" style="margin-bottom:10px"><span class="dim grow">Live output from Minecraft.</span><button class="btn sm" id="g-ask">Ask the Mind about this log</button></div><pre class="log" id="g-log">${esc(lines.join('\n')) || 'Start the game to see its log here.'}</pre>`;
  const l = $('#g-log'); l.scrollTop = l.scrollHeight;
  $('#g-ask').onclick = () => askAI(`Read the game log of instance "${S.inst.id}" and tell me what's wrong and how to fix it.`);
}
function tabOpts() {
  const i = S.inst;
  $('#i-body').innerHTML = `<div class="card" style="max-width:560px">
    <label class="f"><span>Name</span><input id="o-name" maxlength="40" value="${esc(i.name)}"></label>
    <label class="f"><span>Memory (RAM) in MB <small class="tiny">empty = use the default from Settings</small></span><input id="o-ram" type="number" min="1024" step="512" value="${i.ramMB || ''}"></label>
    <div class="row wrap" style="margin-top:18px"><button class="btn hot" id="o-save">Save</button><button class="btn" id="o-folder">Open folder</button><button class="btn" id="o-boost">⚡ Speed boost mods</button><span class="grow"></span><button class="btn danger" id="o-del">Delete instance</button></div></div>`;
  $('#o-save').onclick = async () => { try { S.inst = await lab.updateInstance({ id: i.id, patch: { name: $('#o-name').value, ramMB: $('#o-ram').value ? Number($('#o-ram').value) : null } }); await loadInstances(); toast('Saved', 'good'); renderInstance(); } catch (e) { toast(errText(e), 'bad'); } };
  $('#o-folder').onclick = () => lab.openFolder(i.id);
  $('#o-boost').onclick = async () => { toast('Adding speed mods…'); try { const r = await lab.speedBoost(i.id); S.inst = r.instance; toast(`Added ${r.added.join(', ') || 'nothing new'}`, 'good'); } catch (e) { toast(errText(e), 'bad'); } };
  $('#o-del').onclick = () => {
    const m = modal(`<h2>Delete “${esc(i.name)}”?</h2><p class="dim">Its worlds, mods and settings are deleted from this computer. This can't be undone.</p><div class="end"><button class="btn" id="d-no">Keep it</button><button class="btn hot" id="d-yes">Delete</button></div>`);
    m.querySelector('#d-no').onclick = closeModal;
    m.querySelector('#d-yes').onclick = async () => { await lab.deleteInstance(i.id); closeModal(); await loadInstances(); go('library'); };
  };
}

// ---------- play ----------
async function playToggle(id) {
  if (S.running.has(id)) { await lab.stop(id); return; }
  S.status[id] = { stage: 'Starting…' }; updateStatus(id);
  try { await lab.launch(id); }
  catch (e) { S.status[id] = null; updateStatus(id); toast(errText(e), 'bad'); }
}
function updateStatus(id) {
  if (S.page === 'instance' && S.inst?.id === id) {
    const st = S.status[id];
    const el = $('#i-status'); if (el) el.innerHTML = st && st.stage !== 'running' ? `${esc(st.stage)}${st.pct ? `<div class="bar"><i style="width:${Math.round(st.pct * 100)}%"></i></div>` : ''}` : S.running.has(id) ? 'Playing. Type /ai in Minecraft to talk to BlazeMind.' : '';
    const b = $('#i-play'); if (b) b.textContent = S.running.has(id) ? '■ Stop' : '▶ Play';
  }
}
lab.onLaunchStatus(d => {
  if (d.stage === 'running') { S.running.add(d.id); S.status[d.id] = null; if (S.page === 'home') pageHome(); }
  else S.status[d.id] = d;
  updateStatus(d.id);
});
lab.onLaunchLog(d => {
  const l = (S.logs[d.id] ||= []); l.push(d.line); if (l.length > 1500) l.splice(0, l.length - 1500);
  if (S.page === 'instance' && S.inst?.id === d.id && S.tab === 'log') { const el = $('#g-log'); if (el) { const end = el.scrollTop + el.clientHeight > el.scrollHeight - 30; el.textContent = l.join('\n'); if (end) el.scrollTop = el.scrollHeight; } }
});
lab.onLaunchClosed(d => {
  S.running.delete(d.id); S.status[d.id] = null; updateStatus(d.id);
  if (d.code && d.code !== 0) toast('Minecraft closed with an error. Ask the Mind: “why did my game crash?”', 'bad');
  if (S.page === 'home') pageHome();
});

// ---------- discover (modpacks) ----------
function pageDiscover() {
  P().innerHTML = `<div class="page-head"><div class="grow"><h1>Discover</h1><p>Modpacks from Modrinth. Each one installs as its own instance.</p></div></div>
    <form class="row" id="d-form" style="margin-bottom:16px"><input id="d-q" placeholder="Search modpacks (horror, skyblock, tech, adventure…)"><button class="btn hot">Search</button></form>
    <div class="status" id="d-prog"></div><div class="list" id="d-res"></div>`;
  const search = async () => {
    $('#d-res').innerHTML = '<p class="dim">Searching…</p>';
    try {
      const r = await lab.searchMods({ source: 'modrinth', query: $('#d-q').value, type: 'modpack' });
      $('#d-res').innerHTML = (r.hits || []).map(h => `<div class="item">${h.icon ? `<img src="${esc(h.icon)}" alt="">` : '<div class="ph"></div>'}<div class="t"><b>${esc(h.title)}</b><small>${esc(h.description)}</small></div><button class="btn sm hot" data-p="${esc(h.id)}" data-n="${esc(h.title)}">Install</button></div>`).join('') || '<p class="dim">Nothing found.</p>';
      $$('[data-p]').forEach(b => b.onclick = async () => {
        $$('[data-p]').forEach(x => x.disabled = true);
        try { const r = await lab.installModpack({ source: 'modrinth', projectId: b.dataset.p, title: b.dataset.n }); await loadInstances(); toast(`${b.dataset.n} installed`, 'good'); if (r?.instance) openInstance(r.instance.id); }
        catch (e) { toast(errText(e), 'bad'); $$('[data-p]').forEach(x => x.disabled = false); }
      });
    } catch (e) { $('#d-res').innerHTML = `<p class="err">${esc(errText(e))}</p>`; }
  };
  $('#d-form').onsubmit = e => { e.preventDefault(); search(); };
  search();
}
lab.onModpackProgress(p => { const el = $('#d-prog'); if (el) el.innerHTML = p ? `${esc(p.stage)} ${p.total > 1 ? `${p.done}/${p.total}` : ''}<div class="bar"><i style="width:${p.total ? Math.round(p.done / p.total * 100) : 0}%"></i></div>` : ''; });

// ---------- create ----------
const AI_TOOLS = [
  { ico: '🧪', t: 'Data pack', d: 'New recipes, loot, custom enchantments, mob drops, tick functions. Loads instantly with /reload.', p: 'Make a data pack for my current world that ' },
  { ico: '🎨', t: 'Resource pack', d: 'Repaint items and blocks, rename things, change sounds. Reloads in the running game.', p: 'Make a resource pack that ' },
  { ico: '🏰', t: 'Build', d: 'Castles, houses, arenas, pixel art, built with commands right where you stand.', p: 'Build ' },
  { ico: '⚔', t: 'Custom item', d: 'Weapons and tools with custom names, enchantments and effects, given to you now.', p: 'Give me a custom item: ' },
  { ico: '🌩', t: 'World control', d: 'Time, weather, game rules, effects, teleports, spawning, anything with commands.', p: 'In my world, ' },
  { ico: '🩺', t: 'Fix my game', d: 'Reads the game log and explains crashes, then fixes configs or mods.', p: 'My game has a problem: ' },
];
let mpPick = [];
function pageCreate() {
  P().innerHTML = `<div class="page-head"><div class="grow"><h1>Create</h1><p>Make your own modpacks, and let the AI make data packs, resource packs, builds and items. Most of it works while the game runs, with no restart.</p></div></div>
    <h3 class="section-title">MODPACK BUILDER</h3>
    <div class="card" style="margin-bottom:26px">
      <div class="row wrap"><input id="mp-name" placeholder="Modpack name" style="max-width:220px"><select id="mp-ver" style="max-width:150px"></select><select id="mp-load" style="max-width:140px"><option value="fabric">Fabric</option><option value="quilt">Quilt</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option></select>
        <form class="row grow" id="mp-form"><input id="mp-q" placeholder="Search mods to add"><button class="btn">Search</button></form></div>
      <div class="picked" id="mp-picked"></div>
      <div class="list" id="mp-res" style="max-height:300px;overflow:auto"></div>
      <div class="row" style="margin-top:12px"><span class="tiny grow">Or describe it to the AI: “make a cozy farming modpack for 1.20.1”.</span><button class="btn" id="mp-ai">Let the AI pick</button><button class="btn hot" id="mp-make">Create modpack</button></div>
      <div class="status" id="mp-status"></div>
    </div>
    <h3 class="section-title">AI CREATIONS</h3>
    <div class="studio">${AI_TOOLS.map((x, n) => `<div class="tool" data-n="${n}"><div class="big-ico">${x.ico}</div><h3>${x.t}</h3><p>${x.d}</p></div>`).join('')}</div>`;
  $$('.tool').forEach(c => c.onclick = () => { const x = AI_TOOLS[c.dataset.n]; const ta = $('#mind-text'); showMind(); ta.value = x.p; ta.focus(); });
  lab.versions(false).then(v => { $('#mp-ver').innerHTML = v.slice(0, 60).map(x => `<option>${esc(x.id)}</option>`).join(''); }).catch(() => { $('#mp-ver').innerHTML = '<option>1.21.1</option>'; });
  const renderPicked = () => { $('#mp-picked').innerHTML = mpPick.map((m, n) => `<span class="chip">${esc(m.title)} <a href="#" data-x="${n}">✕</a></span>`).join('') || '<span class="tiny">No mods picked yet.</span>'; $$('[data-x]').forEach(a => a.onclick = e => { e.preventDefault(); mpPick.splice(a.dataset.x, 1); renderPicked(); }); };
  renderPicked();
  $('#mp-form').onsubmit = async e => {
    e.preventDefault();
    $('#mp-res').innerHTML = '<p class="dim">Searching…</p>';
    try {
      const r = await lab.searchMods({ source: 'modrinth', query: $('#mp-q').value, mcVersion: $('#mp-ver').value, loader: $('#mp-load').value, type: 'mod' });
      $('#mp-res').innerHTML = (r.hits || []).map(h => `<div class="item">${h.icon ? `<img src="${esc(h.icon)}" alt="">` : '<div class="ph"></div>'}<div class="t"><b>${esc(h.title)}</b><small>${esc(h.description)}</small></div><button class="btn sm" data-pick="${esc(h.id)}" data-t="${esc(h.title)}">Add</button></div>`).join('') || '<p class="dim">Nothing for that version and loader.</p>';
      $$('[data-pick]').forEach(b => b.onclick = () => { if (!mpPick.some(m => m.id === b.dataset.pick)) mpPick.push({ id: b.dataset.pick, title: b.dataset.t }); renderPicked(); });
    } catch (e2) { $('#mp-res').innerHTML = `<p class="err">${esc(errText(e2))}</p>`; }
  };
  $('#mp-ai').onclick = () => { showMind(); $('#mind-text').value = `Make a ${$('#mp-load').value} modpack for Minecraft ${$('#mp-ver').value} called "${$('#mp-name').value || 'My Pack'}" that is about: `; $('#mind-text').focus(); };
  $('#mp-make').onclick = async () => {
    const name = $('#mp-name').value.trim() || 'My Modpack';
    if (!mpPick.length) return toast('Add some mods first', 'bad');
    const st = $('#mp-status'); $('#mp-make').disabled = true;
    try {
      const inst = await lab.createInstance({ name, mcVersion: $('#mp-ver').value, loader: $('#mp-load').value });
      const failed = [];
      for (let n = 0; n < mpPick.length; n++) {
        st.textContent = `Installing ${mpPick[n].title} (${n + 1}/${mpPick.length})…`;
        try { await lab.installMod({ instanceId: inst.id, source: 'modrinth', projectId: mpPick[n].id, type: 'mod' }); } catch { failed.push(mpPick[n].title); }
      }
      st.textContent = failed.length ? `Done. Couldn't add: ${failed.join(', ')}` : 'Done!';
      mpPick = []; await loadInstances(); toast(`${name} is ready`, 'good'); openInstance(inst.id);
    } catch (e) { st.textContent = errText(e); }
    finally { const b = $('#mp-make'); if (b) b.disabled = false; }
  };
}

// ---------- settings ----------
async function pageSettings() {
  const [ai, st, ver] = await Promise.all([lab.ai.settings(), lab.getSettings(), lab.appVersion().catch(() => '')]);
  const bridges = await lab.ai.bridgeVersions().catch(() => []);
  let prov = ai.provider;
  P().innerHTML = `<div class="page-head"><div class="grow"><h1>Settings</h1><p>BlazeMind ${esc(ver)}</p></div></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr));align-items:start">
      <div class="card"><h3 style="font-size:16px">✦ AI</h3>
        <p class="tiny">Use any AI you like. Keys stay on this computer, encrypted. Each service charges you for what you use (Ollama is free and runs offline on your PC). A ChatGPT Plus or Claude Pro subscription doesn't include an API key; you get one from the developer site.</p>
        <label class="f"><span>AI service</span><select id="s-prov">${Object.entries(ai.providers).map(([k, p]) => `<option value="${k}" ${k === prov ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <div id="s-provbox"></div>
        <label class="switch"><input type="checkbox" id="s-echo" ${ai.echoToGame ? 'checked' : ''}> Show the AI's replies in Minecraft chat while I play</label>
        <div class="row" style="margin-top:16px"><button class="btn hot" id="s-ai-save">Save AI settings</button><button class="btn" id="s-ai-check">Check key</button><button class="btn" id="s-ai-test">Test chat</button></div>
        <p class="tiny" id="s-ai-result"></p>
        <p class="tiny" style="margin-top:14px">In-game AI (BlazeMind Bridge mod) is built for Minecraft ${esc(bridges.join(', ') || '(none in this build)')} on Fabric and Quilt. The launcher adds it for you.</p>
      </div>
      <div class="card"><h3 style="font-size:16px">Minecraft</h3>
        <label class="f"><span>Default memory (MB)</span><input id="s-ram" type="number" min="1024" step="512" value="${st.ramMB}"></label>
        <label class="switch"><input type="checkbox" id="s-hide" ${st.hideOnPlay ? 'checked' : ''}> Hide BlazeMind while I play</label>
        <div class="row" style="margin-top:16px"><button class="btn hot" id="s-save">Save</button></div>
        <h3 style="font-size:16px;margin-top:26px">Account</h3>
        <div class="row" style="margin-top:10px"><img id="s-face" src="${esc(S.user.skin || 'icon.png')}" width="36" height="36" style="border-radius:10px;image-rendering:pixelated" alt=""><b class="grow">${esc(S.user.name)}</b><button class="btn danger sm" id="s-out">Sign out</button></div>
        <h3 style="font-size:16px;margin-top:26px">Updates</h3>
        <div class="row" style="margin-top:10px"><span class="dim grow" id="s-up">You have ${esc(ver)}.</span><button class="btn sm" id="s-check">Check</button></div>
      </div>
    </div>`;
  $('#s-face').onerror = e => { e.target.onerror = null; e.target.src = 'icon.png'; };
  const box = () => {
    const p = ai.providers[prov];
    $('#s-provbox').innerHTML = `
      <label class="f"><span>Model</span><input id="s-model" value="${esc(p.model)}" placeholder="model name"></label>
      ${prov === 'custom' || prov === 'ollama' ? `<label class="f"><span>Server address</span><input id="s-base" value="${esc(p.base)}"></label>` : ''}
      ${p.needsKey || prov === 'custom' ? `<label class="f"><span>API key ${p.keySet ? '<small class="tiny">(saved; type to replace)</small>' : ''}</span><input id="s-key" type="password" placeholder="${esc(p.keyHint)}"></label>` : `<p class="tiny" style="margin-top:12px">${esc(p.keyHint)}. Then run <code>ollama pull ${esc(p.model)}</code> once.</p>`}`;
  };
  box();
  $('#s-prov').onchange = () => { prov = $('#s-prov').value; box(); };
  const saveAI = async () => {
    const d = { provider: prov, model: $('#s-model').value, echoToGame: $('#s-echo').checked };
    if ($('#s-base')) d.base = $('#s-base').value;
    if ($('#s-key')?.value) d.key = $('#s-key').value;
    await lab.ai.saveSettings(d); refreshMindHeader();
  };
  $('#s-ai-save').onclick = async () => { await saveAI(); toast('AI settings saved', 'good'); pageSettings(); };
  $('#s-ai-check').onclick = async () => {
    const out = $('#s-ai-result'); out.className = 'tiny'; out.textContent = 'Checking…';
    try { await saveAI(); const r = await lab.ai.checkKey(); out.className = r.ok ? 'tiny' : 'tiny err'; out.style.color = r.ok ? 'var(--ok)' : ''; out.textContent = (r.ok ? '✓ ' : '✕ ') + r.text; }
    catch (e) { out.className = 'tiny err'; out.textContent = errText(e); }
  };
  $('#s-ai-test').onclick = async () => { await saveAI(); showMind(); askAI('Say hi in one short sentence and tell me which AI model you are.'); };
  $('#s-save').onclick = async () => { await lab.setSettings({ ramMB: Number($('#s-ram').value) || 4096, hideOnPlay: $('#s-hide').checked }); toast('Saved', 'good'); };
  $('#s-out').onclick = async () => { await lab.logout(); location.reload(); };
  $('#s-check').onclick = async () => {
    $('#s-up').textContent = 'Checking…';
    try { const r = await lab.checkUpdate(); if (r?.available) { $('#s-up').innerHTML = `Version ${esc(r.version)} is out. <a href="#" id="s-get">Update now</a>`; $('#s-get').onclick = e => { e.preventDefault(); lab.installUpdate(); }; } else $('#s-up').textContent = 'You\'re up to date.'; }
    catch (e) { $('#s-up').textContent = errText(e); }
  };
}

// ---------- Mind (AI dock) ----------
function showMind() { $('#app').classList.remove('mind-hidden'); $('#mind-tab').classList.add('hidden'); }
$('#mind-toggle').onclick = () => { $('#app').classList.add('mind-hidden'); $('#mind-tab').classList.remove('hidden'); };
$('#mind-tab').onclick = showMind;
$('#mind-new').onclick = () => lab.ai.reset();
async function refreshMindHeader() { try { const a = await lab.ai.settings(); $('#mind-prov').textContent = `${a.providers[a.provider].name.split(' (')[0]} · ${a.model}`; } catch {} }
function askAI(text) { showMind(); lab.ai.ask(text); }
$('#mind-form').onsubmit = e => { e.preventDefault(); const t = $('#mind-text').value.trim(); if (!t) return; $('#mind-text').value = ''; lab.ai.ask(t); };
$('#mind-text').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#mind-form').requestSubmit(); } });
const TOOL_LABEL = { game_status: 'Looking at your game', run_commands: 'Running commands', install_datapack: 'Adding a data pack', install_resourcepack: 'Making a resource pack', list_instances: 'Checking your instances', create_instance: 'Creating an instance', search_content: 'Searching Modrinth', install_content: 'Installing', install_modpack: 'Installing a modpack', launch_instance: 'Starting Minecraft', read_game_log: 'Reading the game log', list_files: 'Looking at files', read_file: 'Reading a file', write_file: 'Writing a file', list_servers: 'Checking servers', server_command: 'Running a server command' };
function feedAdd(el) {
  const f = $('#feed'); f.querySelector('.mind-hello')?.remove();
  f.appendChild(el); f.scrollTop = f.scrollHeight;
}
function div(cls, html) { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; }
let lastStep = null;
lab.ai.onEvent(ev => {
  if (ev.type === 'reset') { $('#feed').innerHTML = `<div class="mind-hello"><div class="mini-flame">${Art.flame(46)}</div><p><b>New chat.</b> What should we do?</p></div>`; return; }
  if (ev.type === 'busy') { S.aiBusy = ev.busy; $('#orb').classList.toggle('busy', ev.busy > 0); return; }
  if (ev.type === 'user') feedAdd(div('msg me', `${ev.from === 'game' ? '<span class="from">IN GAME</span>' : ''}${esc(ev.text)}`));
  if (ev.type === 'assistant') feedAdd(div('msg ai', esc(ev.text)));
  if (ev.type === 'thought') feedAdd(div('thought', esc(ev.text)));
  if (ev.type === 'error') feedAdd(div('msg err', '⚠ ' + esc(ev.text)));
  if (ev.type === 'tool') {
    let extra = '';
    if (ev.name === 'run_commands') extra = ': ' + (ev.input?.commands || []).slice(0, 3).join(' · ') + ((ev.input?.commands || []).length > 3 ? ` (+${ev.input.commands.length - 3})` : '');
    else if (ev.input?.name) extra = ': ' + ev.input.name; else if (ev.input?.query) extra = ': ' + ev.input.query;
    lastStep = div('step', '⟳ ' + esc((TOOL_LABEL[ev.name] || ev.name) + extra));
    feedAdd(lastStep);
  }
  if (ev.type === 'tool-done' && lastStep) { lastStep.classList.add(ev.ok ? 'ok' : 'bad'); lastStep.innerHTML = (ev.ok ? '✓ ' : '✕ ') + lastStep.innerHTML.slice(2) + (ev.ok ? '' : ` <br>${esc(ev.text)}`); lastStep = null; }
});
function renderGame() {
  const g = S.games[0];
  const el = $('#mind-game');
  el.classList.toggle('on', !!g);
  el.textContent = g ? `Game: ${g.status?.inWorld ? 'in world' : 'connected'}` : 'Game: off';
  el.title = g ? 'Minecraft is connected. Type /ai in game, or ask here and it happens in your world.' : 'Start a Fabric/Quilt instance to connect the in-game AI.';
}
lab.ai.onGame(list => { S.games = list || []; renderGame(); if (S.page === 'instance' && S.inst) renderInstance(); });
setInterval(async () => { try { S.games = await lab.ai.games(); renderGame(); } catch {} }, 10000);

boot();
