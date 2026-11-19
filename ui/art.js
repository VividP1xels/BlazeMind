// BlazeMind artwork drawn in code: the flame logo and instance tiles
(function () {
  const FLAME = [
    '.......y........', '......yo......c.', '......oo.....cCc', '.....orr......c.',
    '....oorr...o....', '...oorrrr.oo....', '...orrrrrrror...', '..orrryyrrrrro..',
    '..orryhhyrrrro..', '.orryhwwhyrrrro.', '.orryhwCwhyrrro.', '.orryhwwwhyrrro.',
    '.oorryhhhyrrroo.', '..oorryyyrrroo..', '...ooorrrrooo...', '.....oooooo.....'];
  const COLORS = { o: '#9e1f0b', r: '#ff5a14', y: '#ffb020', h: '#ffe066', w: '#fff7da', C: '#3fd0ff', c: '#9be8ff' };
  function flame(size) {
    let r = '';
    FLAME.forEach((row, y) => [...row].forEach((ch, x) => { if (COLORS[ch]) r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${COLORS[ch]}"/>`; }));
    return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${r}</svg>`;
  }
  const HUES = [14, 28, 40, 350, 196, 160, 268, 320];
  function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
  // A tile for an instance: warm gradient picked from its name, with its initials
  function tile(inst, size = 56) {
    const h = HUES[hash(inst.id || inst.name) % HUES.length];
    const words = String(inst.name || '?').trim().split(/\s+/);
    const ini = (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase().replace(/[<>&"]/g, '');
    return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g${h}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 90% 58%)"/><stop offset="1" stop-color="hsl(${(h + 330) % 360} 80% 32%)"/></linearGradient></defs>
      <rect width="64" height="64" rx="16" fill="url(#g${h})"/><path d="M0 44 Q32 30 64 44 V64 H0z" fill="#0003"/>
      <text x="32" y="40" text-anchor="middle" font-family="Orbitron" font-weight="900" font-size="22" fill="#fff">${ini}</text></svg>`;
  }
  window.Art = { flame, tile };
})();
