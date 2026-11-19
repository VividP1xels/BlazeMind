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
  ({ home: pageHome, library: pageLibrary, discover: pageDiscover, create: pageCreate, servers: pageServers, settings: pageSettings })[page]?.();
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
    <div class="tabs">${[['content', 'Installed'], ['add', 'Add content'], ['worlds', 'Worlds'], ['shots', 'Screenshots'], ['log', 'Game log'], ['repair', '🛠 Repair'], ['opts', 'Options']].map(([k, v]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-t="${k}">${v}</button>`).join('')}</div>
    <div id="i-body"></div>`;
  $('#i-play').onclick = () => playToggle(i.id);
  $$('.tab').forEach(t => t.onclick = () => { S.tab = t.dataset.t; renderInstance(); });
  ({ content: tabContent, add: tabAdd, worlds: tabWorlds, shots: tabShots, log: tabLog, repair: tabRepair, opts: tabOpts })[S.tab]();
}
function tabContent() {
  const i = S.inst, mods = i.mods || [];
  if (!mods.length) { $('#i-body').innerHTML = `<p class="dim">Nothing installed yet. Use <b>Add content</b>, or ask the Mind: “add the best performance mods”.</p>`; return; }
  const groups = {};
  for (const m of mods) (groups[m.type || 'mod'] ||= []).push(m);
  $('#i-body').innerHTML = `<div class="row" style="margin-bottom:14px"><input id="c-filter" placeholder="Filter ${mods.length} add-ons…" style="max-width:300px"><span class="grow"></span><button class="btn sm" id="c-upd">Check for updates</button></div><div id="c-updates"></div>` + Object.entries(groups).map(([t, list]) => `<h3 class="section-title">${(TYPE_NAMES[t] || t).toUpperCase()} · ${list.length}</h3><div class="list" style="margin-bottom:18px">${list.map(m => `
    <div class="item ${m.disabled ? 'off' : ''}">${m.icon ? `<img src="${esc(m.icon)}" alt="">` : '<div class="ph"></div>'}
      <div class="t"><b>${esc(m.title || m.file)}</b><small>${esc(m.version || m.file || '')}</small></div>
      <button class="btn sm" data-tog="${esc(m.file)}">${m.disabled ? 'Turn on' : 'Turn off'}</button>
      <button class="ghost" data-rm="${esc(m.file)}" title="Remove">✕</button></div>`).join('')}</div>`).join('');
  $('#c-filter').oninput = () => { const q = $('#c-filter').value.toLowerCase(); $$('#i-body .item').forEach(el => el.classList.toggle('hidden', !el.textContent.toLowerCase().includes(q))); };
  $('#c-upd').onclick = async () => {
    const box = $('#c-updates'); box.innerHTML = '<p class="dim">Checking Modrinth…</p>';
    try {
      const ups = await lab.checkModUpdates(i.id);
      if (!ups.length) { box.innerHTML = '<p class="tiny" style="color:var(--ok)">✓ Everything is up to date.</p>'; return; }
      box.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="row"><b class="grow">${ups.length} update${ups.length > 1 ? 's' : ''} available</b><button class="btn sm hot" id="c-all">Update all</button></div><div class="tiny" style="margin-top:6px">${ups.map(u => `${esc(u.title)}: ${esc(u.from)} → ${esc(u.to)}`).join('<br>')}</div></div>`;
      $('#c-all').onclick = async () => { $('#c-all').disabled = true; try { await lab.updateMods({ id: i.id, files: ups.map(u => u.file) }); S.inst = await lab.getInstance(i.id); toast('Updated', 'good'); tabContent(); } catch (e) { toast(errText(e), 'bad'); } };
    } catch (e) { box.innerHTML = `<p class="err">${esc(errText(e))}</p>`; }
  };
  $$('[data-tog]').forEach(b => b.onclick = async () => { try { await lab.toggleMod({ instanceId: i.id, file: b.dataset.tog }); S.inst = await lab.getInstance(i.id); tabContent(); } catch (e) { toast(errText(e), 'bad'); } });
  $$('[data-rm]').forEach(b => b.onclick = async () => { try { await lab.removeMod({ instanceId: i.id, file: b.dataset.rm }); S.inst = await lab.getInstance(i.id); renderInstance(); } catch (e) { toast(errText(e), 'bad'); } });
}
let addType = 'mod';
function tabAdd() {
  const i = S.inst;
  $('#i-body').innerHTML = `<div class="row wrap" style="margin-bottom:14px"><div class="seg" id="a-type">${Object.entries({ ...TYPE_NAMES, texturepack: 'Texture packs' }).map(([k, v]) => `<button data-k="${k}" class="${addType === k ? 'on' : ''}">${v}</button>`).join('')}</div>
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
function tabWorlds() {
  const i = S.inst;
  $('#i-body').innerHTML = `<div class="row" style="margin-bottom:12px"><span class="dim grow">Your saved worlds in this instance.</span><button class="btn sm" id="w-imp">Import world .zip</button><button class="btn sm" id="w-open">Open saves folder</button></div><div class="list" id="w-list"><p class="dim">Loading…</p></div>`;
  $('#w-open').onclick = () => lab.worlds.open({ id: i.id });
  $('#w-imp').onclick = async () => { try { await lab.worlds.import({ id: i.id }); tabWorlds(); toast('World imported', 'good'); } catch (e) { toast(errText(e), 'bad'); } };
  lab.worlds.list(i.id).then(ws => {
    $('#w-list').innerHTML = ws.length ? ws.sort((a, b) => b.played - a.played).map(w => `<div class="item">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : '<div class="ph"></div>'}<div class="t"><b>${esc(w.name)}</b><small>${ago(w.played)} · ${(w.size / 1048576).toFixed(1)} MB</small></div>
      <button class="btn sm hot" data-wp="${esc(w.name)}">▶ Play</button><button class="btn sm" data-wb="${esc(w.name)}">Back up</button><button class="btn sm" data-wo="${esc(w.name)}">Open</button><button class="ghost" data-wd="${esc(w.name)}" title="Delete">✕</button></div>`).join('') : '<p class="dim">No worlds yet. Play once to make one.</p>';
    $$('[data-wp]').forEach(b => b.onclick = async () => { await lab.quickPlay({ id: i.id, world: b.dataset.wp }); playToggle(i.id); });
    $$('[data-wb]').forEach(b => b.onclick = async () => { try { await lab.worlds.backup({ id: i.id, name: b.dataset.wb }); toast('Backup saved', 'good'); } catch (e) { toast(errText(e), 'bad'); } });
    $$('[data-wo]').forEach(b => b.onclick = () => lab.worlds.open({ id: i.id, name: b.dataset.wo }));
    $$('[data-wd]').forEach(b => b.onclick = () => {
      const m = modal(`<h2>Delete “${esc(b.dataset.wd)}”?</h2><p class="dim">This world is gone for good unless you made a backup.</p><div class="end"><button class="btn" id="x-no">Keep it</button><button class="btn hot" id="x-yes">Delete</button></div>`);
      m.querySelector('#x-no').onclick = closeModal;
      m.querySelector('#x-yes').onclick = async () => { try { await lab.worlds.remove({ id: i.id, name: b.dataset.wd }); closeModal(); tabWorlds(); } catch (e) { toast(errText(e), 'bad'); } };
    });
  }).catch(e => { $('#w-list').innerHTML = `<p class="err">${esc(errText(e))}</p>`; });
}
function tabShots() {
  const i = S.inst;
  $('#i-body').innerHTML = `<div class="row" style="margin-bottom:12px"><span class="dim grow">Press F2 in Minecraft to take a screenshot.</span><button class="btn sm" id="sh-open">Open folder</button></div><div class="shots" id="sh-list"><p class="dim">Loading…</p></div>`;
  $('#sh-open').onclick = () => lab.shots.open({ id: i.id });
  lab.shots.list(i.id).then(list => {
    $('#sh-list').innerHTML = list.length ? list.sort((a, b) => b.time - a.time).map(x => `<figure><img src="${esc(x.url)}" alt="" loading="lazy" data-f="${esc(x.file)}"><figcaption>${ago(x.time)} <a href="#" data-del="${esc(x.file)}">delete</a></figcaption></figure>`).join('') : '<p class="dim">No screenshots yet.</p>';
    $$('#sh-list img').forEach(im => im.onclick = () => lab.shots.open({ id: i.id, file: im.dataset.f }));
    $$('[data-del]').forEach(a => a.onclick = async e => { e.preventDefault(); await lab.shots.remove({ id: i.id, file: a.dataset.del }); tabShots(); });
  });
}
function tabRepair() {
  const i = S.inst;
  $('#i-body').innerHTML = `<div class="card" style="max-width:640px">
    <h3 style="font-size:16px">Repair this instance</h3>
    <p class="dim">Use this if the game won't start, crashes right away, or mods are missing. Your worlds are never touched.</p>
    <label class="switch"><input type="checkbox" id="r-mods" checked> Check every mod and pack, and download broken or missing ones again</label>
    <label class="switch"><input type="checkbox" id="r-game" checked> Download Minecraft ${esc(i.mcVersion)}'s game files again</label>
    ${i.loader !== 'vanilla' ? `<label class="switch"><input type="checkbox" id="r-load" checked> Set up ${LOADERS[i.loader]} again</label>` : ''}
    <label class="switch"><input type="checkbox" id="r-clean" checked> Clear stuck lock files</label>
    <label class="switch"><input type="checkbox" id="r-opts"> Reset video and control settings (fixes black screens; the old file is kept)</label>
    <div class="row wrap" style="margin-top:18px"><button class="btn hot" id="r-go">🛠 Repair</button><button class="btn" id="r-safe">Start in safe mode (no mods)</button><button class="btn" id="r-ai">Ask the AI to find the problem</button></div>
    <div id="r-out" style="margin-top:14px"></div></div>`;
  $('#r-go').onclick = async () => {
    const out = $('#r-out'); $('#r-go').disabled = true; out.innerHTML = '<p class="dim">Repairing… (this can take a minute)</p>';
    try {
      const rep = await lab.repairInstance({ id: i.id, mods: $('#r-mods').checked, gameFiles: $('#r-game').checked, loader: $('#r-load')?.checked ?? false, cleanup: $('#r-clean').checked, options: $('#r-opts').checked });
      out.innerHTML = `<p style="color:var(--ok)"><b>✓ Done.</b> Press Play to finish.</p><ul class="dim">${rep.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`;
      S.inst = await lab.getInstance(i.id);
    } catch (e) { out.innerHTML = `<p class="err">${esc(errText(e))}</p>`; }
    finally { const b = $('#r-go'); if (b) b.disabled = false; }
  };
  $('#r-safe').onclick = async () => { await lab.safeMode(i.id); playToggle(i.id); };
  $('#r-ai').onclick = () => askAI(`My instance "${i.name}" (id ${i.id}) has a problem. Read its game log, find what's wrong, and fix it if you can (configs, removing or updating the broken mod).`);
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
    <div class="row wrap" style="margin-top:18px"><button class="btn hot" id="o-save">Save</button><button class="btn" id="o-folder">Open folder</button><button class="btn" id="o-boost">⚡ Speed boost mods</button><button class="btn" id="o-dup">Duplicate</button><span class="grow"></span><button class="btn danger" id="o-del">Delete instance</button></div></div>`;
  $('#o-save').onclick = async () => { try { S.inst = await lab.updateInstance({ id: i.id, patch: { name: $('#o-name').value, ramMB: $('#o-ram').value ? Number($('#o-ram').value) : null } }); await loadInstances(); toast('Saved', 'good'); renderInstance(); } catch (e) { toast(errText(e), 'bad'); } };
  $('#o-folder').onclick = () => lab.openFolder(i.id);
  $('#o-dup').onclick = async () => { try { const c = await lab.duplicateInstance(i.id); await loadInstances(); toast('Copied', 'good'); openInstance(c.id); } catch (e) { toast(errText(e), 'bad'); } };
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

// ---------- discover: modpacks, mods, resource packs, texture packs, shaders, data packs, worlds ----------
const KINDS = [
  ['modpack', 'Modpacks', '📦'], ['mod', 'Mods', '🧩'], ['resourcepack', 'Resource packs', '🎨'], ['texturepack', 'Texture packs', '🧱'],
  ['shader', 'Shaders', '🌅'], ['datapack', 'Data packs', '🧪'], ['world', 'Worlds & maps', '🗺'],
];
const D = { kind: 'modpack', source: 'modrinth', q: '', sort: '', inst: '', ver: '', loader: '', offset: 0, hits: [] };
const fmtNum = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n || 0);
function pageDiscover() {
  const inst = S.instances.find(i => i.id === D.inst);
  P().innerHTML = `<div class="page-head"><div class="grow"><h1>Discover</h1><p>Browse everything on Modrinth and CurseForge. Pick an instance to only see things that work with it.</p></div>
      <div class="seg" id="d-src"><button data-s="modrinth" class="${D.source === 'modrinth' ? 'on' : ''}">Modrinth</button><button data-s="curseforge" class="${D.source === 'curseforge' ? 'on' : ''}">CurseForge</button></div></div>
    <div class="kinds">${KINDS.map(([k, n, i]) => `<button class="kind ${D.kind === k ? 'on' : ''}" data-k="${k}"><span>${i}</span>${n}</button>`).join('')}</div>
    <form class="row wrap filters" id="d-form">
      <input id="d-q" class="grow" style="min-width:220px" placeholder="Search ${esc(KINDS.find(k => k[0] === D.kind)[1].toLowerCase())}…" value="${esc(D.q)}">
      ${D.kind !== 'modpack' ? `<select id="d-inst" style="width:190px"><option value="">Any instance</option>${S.instances.map(i => `<option value="${esc(i.id)}" ${i.id === D.inst ? 'selected' : ''}>${esc(i.name)} (${esc(i.mcVersion)})</option>`).join('')}</select>` : ''}
      <select id="d-ver" style="width:130px" ${inst ? 'disabled' : ''}><option value="">All versions</option></select>
      ${['mod', 'modpack'].includes(D.kind) ? `<select id="d-load" style="width:130px" ${inst ? 'disabled' : ''}><option value="">All loaders</option>${['fabric', 'quilt', 'forge', 'neoforge'].map(l => `<option value="${l}" ${D.loader === l ? 'selected' : ''}>${LOADERS[l]}</option>`).join('')}</select>` : ''}
      <select id="d-sort" style="width:150px">${[['', 'Best match'], ['downloads', 'Most downloaded'], ['newest', 'Newest'], ['updated', 'Recently updated']].map(([v, n]) => `<option value="${v}" ${D.sort === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="btn hot">Search</button>
    </form>
    <div class="status" id="d-prog"></div>
    <div class="results" id="d-res"></div>
    <div style="text-align:center;margin-top:16px"><button class="btn hidden" id="d-more">Load more</button></div>`;
  lab.versions(false).then(v => { const sel = $('#d-ver'); if (!sel) return; sel.innerHTML = '<option value="">All versions</option>' + v.slice(0, 70).map(x => `<option ${x.id === (inst?.mcVersion || D.ver) ? 'selected' : ''}>${esc(x.id)}</option>`).join(''); }).catch(() => {});
  $$('#d-src button').forEach(b => b.onclick = () => { D.source = b.dataset.s; D.offset = 0; pageDiscover(); });
  $$('.kind').forEach(b => b.onclick = () => { D.kind = b.dataset.k; D.offset = 0; D.q = ''; pageDiscover(); });
  $('#d-inst') && ($('#d-inst').onchange = () => { D.inst = $('#d-inst').value; D.offset = 0; pageDiscover(); });
  $('#d-form').onsubmit = e => { e.preventDefault(); readFilters(); D.offset = 0; discoverSearch(); };
  $('#d-more').onclick = () => { D.offset += 20; discoverSearch(true); };
  discoverSearch();
}
function readFilters() { D.q = $('#d-q').value; D.sort = $('#d-sort').value; D.ver = $('#d-ver').value; D.loader = $('#d-load')?.value || ''; }
async function discoverSearch(more) {
  const inst = S.instances.find(i => i.id === D.inst);
  const res = $('#d-res'); if (!more) res.innerHTML = '<p class="dim">Searching…</p>';
  if (D.kind === 'world' && D.source !== 'curseforge') { res.innerHTML = '<p class="dim">Worlds and maps come from CurseForge. Switch to CurseForge above.</p>'; $('#d-more').classList.add('hidden'); return; }
  try {
    const r = await lab.searchMods({ source: D.source, query: D.q, type: D.kind, sort: D.sort || undefined, offset: D.offset,
      mcVersion: inst?.mcVersion || D.ver || undefined, loader: D.kind === 'mod' || D.kind === 'modpack' ? (inst?.loader !== 'vanilla' && inst?.loader) || D.loader || undefined : undefined });
    D.hits = more ? D.hits.concat(r.hits || []) : (r.hits || []);
    res.innerHTML = (r.offline ? '<p class="tiny full">Offline: showing things saved on this computer. Installing needs internet.</p>' : '') + (D.hits.map((h, n) => `
      <div class="rcard" data-n="${n}">
        <div class="rtop">${h.icon ? `<img src="${esc(h.icon)}" alt="" loading="lazy">` : '<div class="ph"></div>'}<div class="t"><b>${esc(h.title)}</b><small>${h.author ? 'by ' + esc(h.author) + ' · ' : ''}⬇ ${fmtNum(h.downloads)}</small></div></div>
        <p>${esc(h.description)}</p>
        <div class="row"><span class="tiny grow">${esc((h.gameVersions || []).slice(0, 3).join(', '))}</span><button class="btn sm hot" data-get="${n}">${D.kind === 'modpack' ? 'Install pack' : 'Install'}</button></div>
      </div>`).join('') || '<p class="dim full">Nothing found. Try other words or filters.</p>');
    $('#d-more').classList.toggle('hidden', !(r.hits || []).length || (r.total && D.hits.length >= r.total));
    $$('.rcard').forEach(c => c.onclick = e => { if (!e.target.closest('[data-get]')) showDetails(D.hits[c.dataset.n]); });
    $$('[data-get]').forEach(b => b.onclick = () => getContent(D.hits[b.dataset.get], D.kind));
  } catch (e) {
    const m = errText(e);
    res.innerHTML = m.includes('CURSEFORGE_KEY_MISSING') ? '<p class="dim">CurseForge needs a free API key. Add one in <a href="#" id="d-cf">Settings</a>, or use Modrinth.</p>' : `<p class="err">${esc(m)}</p>`;
    $('#d-cf') && ($('#d-cf').onclick = ev => { ev.preventDefault(); go('settings'); });
  }
}
// Install something: modpacks become a new instance, everything else goes into an instance you pick
async function getContent(h, kind, versionId) {
  if (kind === 'modpack') {
    toast(`Installing ${h.title}…`);
    try { const r = await lab.installModpack({ source: h.source || D.source, projectId: h.id, title: h.title, icon: h.icon }); await loadInstances(); toast(`${h.title} is ready`, 'good'); closeModal(); if (r?.instance) openInstance(r.instance.id); }
    catch (e) { toast(errText(e), 'bad'); }
    return;
  }
  const install = async id => {
    toast(`Installing ${h.title}…`);
    try {
      const r = await lab.installMod({ instanceId: id, source: h.source || D.source, projectId: h.id, type: kind, versionId });
      toast(`Added ${(r.added || []).map(a => a.title).join(', ') || h.title}`, 'good'); closeModal();
      if (S.inst?.id === id) S.inst = r.instance || S.inst;
    } catch (e) { toast(errText(e), 'bad'); }
  };
  if (D.inst && S.page === 'discover') return install(D.inst);
  const fits = S.instances.filter(i => kind !== 'mod' || i.loader !== 'vanilla');
  if (!fits.length) return toast('Make an instance first (Library → New instance).', 'bad');
  const m = modal(`<h2>Install ${esc(h.title)}</h2><p class="dim">Which instance should get it?</p><div class="list" style="margin-top:14px">${fits.map(i => `<div class="item" style="cursor:pointer" data-to="${esc(i.id)}">${Art.tile(i, 40)}<div class="t"><b>${esc(i.name)}</b><small>${esc(i.mcVersion)} · ${LOADERS[i.loader]}</small></div><button class="btn sm hot">Install here</button></div>`).join('')}</div><div class="end"><button class="btn" id="pk-x">Cancel</button></div>`);
  m.querySelector('#pk-x').onclick = closeModal;
  m.querySelectorAll('[data-to]').forEach(el => el.onclick = () => install(el.dataset.to));
}
async function showDetails(h) {
  const kind = D.kind;
  const m = modal(`<div class="row">${h.icon ? `<img src="${esc(h.icon)}" width="56" height="56" style="border-radius:14px" alt="">` : ''}<div class="grow"><h2>${esc(h.title)}</h2><div class="tiny">⬇ ${fmtNum(h.downloads)}${h.author ? ' · by ' + esc(h.author) : ''}</div></div><button class="btn hot" id="dt-get">Install</button></div>
    <div id="dt-body"><p class="dim">Loading…</p></div><div class="end"><button class="btn" id="dt-x">Close</button></div>`);
  m.querySelector('#dt-x').onclick = closeModal;
  m.querySelector('#dt-get').onclick = () => getContent(h, kind);
  try {
    const inst = S.instances.find(i => i.id === D.inst);
    const d = await lab.modProject({ source: h.source || D.source, id: h.id, type: kind, mcVersion: inst?.mcVersion, loader: inst?.loader });
    const text = d.html ? d.body.replace(/<[^>]+>/g, ' ') : d.body.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]+>/g, '').replace(/[#*_`>]/g, '');
    m.querySelector('#dt-body').innerHTML = `
      ${(d.gallery || []).length ? `<div class="gallery">${d.gallery.slice(0, 6).map(g => `<img src="${esc(g.url)}" alt="${esc(g.title)}" loading="lazy">`).join('')}</div>` : ''}
      <p class="desc">${esc(text.trim().slice(0, 1800))}${text.length > 1800 ? '…' : ''}</p>
      ${kind !== 'modpack' && (d.versions || []).length ? `<h3 class="section-title" style="margin-top:16px">VERSIONS</h3><div class="list">${d.versions.slice(0, 12).map(v => `<div class="item"><div class="t"><b>${esc(v.name || v.number)}</b><small>${esc((v.gameVersions || []).slice(0, 4).join(', '))} · ${esc((v.loaders || []).join(', '))}</small></div><button class="btn sm" data-v="${esc(v.id)}">Install this one</button></div>`).join('')}</div>` : ''}
      ${d.links?.website ? `<p class="tiny" style="margin-top:12px">More: ${esc(d.links.website)}</p>` : ''}`;
    m.querySelectorAll('[data-v]').forEach(b => b.onclick = () => getContent(h, kind, b.dataset.v));
  } catch (e) { m.querySelector('#dt-body').innerHTML = `<p class="err">${esc(errText(e))}</p>`; }
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

// ---------- servers you host on this computer ----------
const SV = { open: null, logs: {} };
async function pageServers() {
  let list = [], info = {};
  try { [list, info] = await Promise.all([lab.servers.list(), lab.servers.info()]); } catch (e) { P().innerHTML = `<p class="err">${esc(errText(e))}</p>`; return; }
  if (SV.open && !list.some(x => x.id === SV.open)) SV.open = null;
  const cur = list.find(x => x.id === SV.open);
  P().innerHTML = `<div class="page-head"><div class="grow"><h1>Servers</h1><p>Host a Minecraft server on this computer for free. Friends on your Wi-Fi join with ${esc((info.lan || [])[0] || 'your local IP')}; friends elsewhere need port forwarding or playit.gg.</p></div><button class="btn hot" id="sv-new">＋ New server</button></div>
    <div class="srv-wrap"><div class="list" style="min-width:260px">${list.map(x => `<div class="item srv ${x.id === SV.open ? 'sel' : ''}" data-sv="${esc(x.id)}"><div class="dot ${x.status}"></div><div class="t"><b>${esc(x.name)}</b><small>${esc(x.mcVersion)} · ${esc(x.loader)} · ${esc(x.status)}${x.players?.length ? ` · ${x.players.length} online` : ''}</small></div></div>`).join('') || '<p class="dim">No servers yet.</p>'}</div>
    <div class="grow" id="sv-body">${cur ? '' : '<p class="dim">Pick a server, or make a new one. The AI can also run commands on running servers.</p>'}</div></div>`;
  $('#sv-new').onclick = () => newServer(info);
  $$('[data-sv]').forEach(el => el.onclick = () => { SV.open = el.dataset.sv; pageServers(); });
  if (!cur) return;
  const running = cur.status !== 'stopped';
  $('#sv-body').innerHTML = `<div class="card">
    <div class="row"><h2 class="grow" style="font-size:20px">${esc(cur.name)}</h2>
      ${running ? '<button class="btn" id="sv-restart">Restart</button><button class="btn danger" id="sv-stop">■ Stop</button>' : '<button class="btn hot" id="sv-start">▶ Start</button>'}
      <button class="btn" id="sv-folder">Folder</button><button class="btn" id="sv-backup">Back up</button></div>
    <div class="chips" style="margin:8px 0 12px"><span class="chip">${esc(cur.mcVersion)}</span><span class="chip">${esc(cur.loader)}</span><span class="chip">port ${esc(cur.port || 25565)}</span>${(cur.players || []).map(p => `<span class="chip ice">${esc(p)}</span>`).join('')}</div>
    <pre class="log" id="sv-log" style="height:42vh"></pre>
    <form class="row" id="sv-cmd" style="margin-top:8px"><input id="sv-in" placeholder="Type a server command (op Steve, time set day, say hi)…" ${running ? '' : 'disabled'}><button class="btn" ${running ? '' : 'disabled'}>Send</button></form>
    <div class="row" style="margin-top:14px"><span class="grow"></span><button class="btn danger sm" id="sv-del">Delete server</button></div></div>`;
  const logEl = $('#sv-log');
  logEl.textContent = SV.logs[cur.id] || await lab.servers.log(cur.id) || 'Not running.'; logEl.scrollTop = logEl.scrollHeight;
  $('#sv-start') && ($('#sv-start').onclick = async () => { try { await lab.servers.start(cur.id); setTimeout(pageServers, 600); } catch (e) { toast(errText(e), 'bad'); } });
  $('#sv-stop') && ($('#sv-stop').onclick = async () => { await lab.servers.stop(cur.id); setTimeout(pageServers, 1500); });
  $('#sv-restart') && ($('#sv-restart').onclick = () => lab.servers.restart(cur.id));
  $('#sv-folder').onclick = () => lab.servers.folder(cur.id);
  $('#sv-backup').onclick = async () => { try { await lab.servers.backup(cur.id); toast('Backup made', 'good'); } catch (e) { toast(errText(e), 'bad'); } };
  $('#sv-cmd').onsubmit = async e => { e.preventDefault(); const c = $('#sv-in').value.trim(); if (!c) return; $('#sv-in').value = ''; await lab.servers.command({ id: cur.id, cmd: c.replace(/^\//, '') }); };
  $('#sv-del').onclick = () => {
    const m = modal(`<h2>Delete “${esc(cur.name)}”?</h2><p class="dim">The server and its world are deleted from this computer.</p><div class="end"><button class="btn" id="x-no">Keep it</button><button class="btn hot" id="x-yes">Delete</button></div>`);
    m.querySelector('#x-no').onclick = closeModal;
    m.querySelector('#x-yes').onclick = async () => { try { await lab.servers.remove(cur.id); closeModal(); SV.open = null; pageServers(); } catch (e) { toast(errText(e), 'bad'); } };
  };
}
async function newServer(info) {
  const m = modal(`<h2>New server</h2>
    <label class="f"><span>Name</span><input id="ns-name" value="My Server" maxlength="40"></label>
    <label class="f"><span>Copy mods from an instance (optional)</span><select id="ns-from"><option value="">No, start empty</option>${S.instances.map(i => `<option value="${esc(i.id)}">${esc(i.name)} (${esc(i.mcVersion)} ${LOADERS[i.loader]})</option>`).join('')}</select></label>
    <div class="row"><label class="f grow"><span>Minecraft version</span><select id="ns-ver"></select></label>
    <label class="f grow"><span>Type</span><select id="ns-load"><option value="paper">Paper (plugins, fastest)</option><option value="vanilla">Vanilla</option><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option></select></label></div>
    <label class="f"><span>Memory: <b id="ns-ramv">4096</b> MB <small class="tiny">(this PC can spare ${esc(info.maxRamMB || '?')} MB)</small></span><input id="ns-ram" type="range" min="1024" max="${Math.max(2048, info.maxRamMB || 8192)}" step="512" value="4096"></label>
    <div class="end"><button class="btn" id="ns-x">Cancel</button><button class="btn hot" id="ns-ok">Create</button></div>`);
  m.querySelector('#ns-x').onclick = closeModal;
  m.querySelector('#ns-ram').oninput = e => { m.querySelector('#ns-ramv').textContent = e.target.value; };
  lab.versions(false).then(v => { m.querySelector('#ns-ver').innerHTML = v.slice(0, 60).map(x => `<option>${esc(x.id)}</option>`).join(''); }).catch(() => {});
  m.querySelector('#ns-from').onchange = e => { const i = S.instances.find(x => x.id === e.target.value); if (i) { m.querySelector('#ns-ver').value = i.mcVersion; m.querySelector('#ns-load').value = i.loader === 'quilt' ? 'fabric' : i.loader === 'vanilla' ? 'paper' : i.loader; } };
  m.querySelector('#ns-ok').onclick = async () => {
    const b = m.querySelector('#ns-ok'); b.disabled = true; b.textContent = 'Creating…';
    try { const sv = await lab.servers.create({ name: m.querySelector('#ns-name').value, mcVersion: m.querySelector('#ns-ver').value, loader: m.querySelector('#ns-load').value, ramMB: Number(m.querySelector('#ns-ram').value), fromInstance: m.querySelector('#ns-from').value || undefined }); closeModal(); SV.open = sv.id; pageServers(); toast('Server created. Press Start.', 'good'); }
    catch (e) { toast(errText(e), 'bad'); b.disabled = false; b.textContent = 'Create'; }
  };
}
lab.servers.onLog(d => { SV.logs[d.id] = ((SV.logs[d.id] || '') + d.text).slice(-200000); if (S.page === 'servers' && SV.open === d.id) { const el = $('#sv-log'); if (el) { el.textContent = SV.logs[d.id]; el.scrollTop = el.scrollHeight; } } });
lab.servers.onStatus(() => { if (S.page === 'servers') pageServers(); });

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
        <h3 style="font-size:16px;margin-top:26px">CurseForge</h3>
        <p class="tiny">Browsing CurseForge needs a free key from console.curseforge.com. ${st.curseforgeKeySet ? '✓ A key is saved.' : ''}</p>
        <div class="row"><input id="s-cf" type="password" placeholder="CurseForge API key"><button class="btn sm" id="s-cf-save">Save</button></div>
        <h3 style="font-size:16px;margin-top:26px">Updates</h3>
        <div class="row" style="margin-top:10px"><span class="dim grow" id="s-up">You have ${esc(ver)}.</span><button class="btn sm" id="s-check">Check</button></div>
      </div>
      <div class="card"><h3 style="font-size:16px">🛠 Repair BlazeMind</h3>
        <p class="tiny">If the launcher acts strange, lists won't load, or every instance fails to start. Your instances, worlds and mods are never deleted.</p>
        <label class="switch"><input type="checkbox" id="rl-cache" checked> Clear saved lists and pictures</label>
        <label class="switch"><input type="checkbox" id="rl-java"> Download Java again</label>
        <label class="switch"><input type="checkbox" id="rl-game"> Download all Minecraft game files again</label>
        <label class="switch"><input type="checkbox" id="rl-sign"> Sign out and back in (fixes login problems)</label>
        <div class="row" style="margin-top:16px"><button class="btn hot" id="rl-go">Repair launcher</button></div>
        <div id="rl-out" class="tiny" style="margin-top:10px"></div>
        <h3 style="font-size:16px;margin-top:26px">Free up space</h3>
        <div id="st-list" class="tiny">Checking…</div>
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
  $('#s-cf-save').onclick = async () => { await lab.setSettings({ curseforgeKey: $('#s-cf').value.trim() }); toast('CurseForge key saved', 'good'); pageSettings(); };
  $('#rl-go').onclick = async () => {
    const out = $('#rl-out'); out.textContent = 'Repairing…';
    try {
      const rep = await lab.repairLauncher({ cache: $('#rl-cache').checked, java: $('#rl-java').checked, gameFiles: $('#rl-game').checked, signIn: $('#rl-sign').checked });
      out.innerHTML = '<b style="color:var(--ok)">✓ Done.</b><br>' + rep.map(esc).join('<br>');
      if ($('#rl-sign').checked) setTimeout(() => location.reload(), 1500);
    } catch (e) { out.innerHTML = `<span class="err">${esc(errText(e))}</span>`; }
  };
  const mb = n => n > 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : (n / 1048576).toFixed(0) + ' MB';
  lab.storage.scan().then(r => {
    const groups = Object.entries(r.groups || {}).filter(([k, v]) => v && typeof v === 'object' && 'size' in v && v.size > 0 && !/friends|advanced/i.test(v.label));
    $('#st-list').innerHTML = groups.length ? groups.map(([k, v]) => `<label class="switch"><input type="checkbox" data-st="${esc(k)}"> ${esc(v.label.replace(/^\S+\s/, ''))} (${mb(v.size)})</label>`).join('') + '<div class="row" style="margin-top:10px"><button class="btn sm" id="st-go">Clean selected</button></div>' : 'Nothing to clean.';
    $('#st-go') && ($('#st-go').onclick = async () => { const keys = $$('[data-st]:checked').map(x => x.dataset.st); if (!keys.length) return; const freed = await lab.storage.clean(keys); toast(`Freed ${mb(freed)}`, 'good'); pageSettings(); });
  }).catch(() => { $('#st-list').textContent = ''; });
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
const TOOL_LABEL = { game_status: 'Looking at your game', run_commands: 'Running commands', install_datapack: 'Adding a data pack', install_resourcepack: 'Making a resource pack', list_instances: 'Checking your instances', create_instance: 'Creating an instance', search_content: 'Searching Modrinth', install_content: 'Installing', install_modpack: 'Installing a modpack', launch_instance: 'Starting Minecraft', read_game_log: 'Reading the game log', list_files: 'Looking at files', read_file: 'Reading a file', write_file: 'Writing a file', list_servers: 'Checking servers', repair_instance: 'Repairing the instance', remove_content: 'Removing', list_worlds: 'Checking worlds', server_command: 'Running a server command' };
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
