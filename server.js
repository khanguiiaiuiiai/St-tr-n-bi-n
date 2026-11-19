// Máy chủ RAFT: OCEAN SURVIVORS — web tĩnh + API lưu map + WebSocket phòng online
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA, 'maps.json');
const INDEX = path.join(__dirname, 'public', 'index.html');

// ---------- lưu map (RAM + ghi file) ----------
let maps = {};
try { maps = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
let saveTimer = null;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA, { recursive: true });
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(maps));
      fs.renameSync(FILE + '.tmp', FILE);
    } catch (e) { console.error('Không ghi được maps.json:', e.message); }
  }, 1500);
};

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', ...CORS }); res.end(JSON.stringify(obj)); };
const readBody = (req, cb) => {
  let b = '', n = 0, dead = false;
  req.on('data', d => { n += d.length; if (n > 2e6) { dead = true; req.destroy(); } else b += d; });
  req.on('end', () => { if (dead) return; try { cb(JSON.parse(b)); } catch (e) { cb(null); } });
};
const validTiles = t => Array.isArray(t) && t.length <= 5000 && t.every(a => Array.isArray(a) && a.length >= 3 && a.length <= 4);

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (u.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }

  if (u.pathname === '/api/map') {
    if (req.method === 'POST') {
      return readBody(req, o => {
        if (!o || typeof o.name !== 'string' || typeof o.ph !== 'string' || typeof o.code !== 'string') return send(res, 400, { error: 'bad' });
        const name = o.name.trim().slice(0, 40), key = name.toLowerCase();
        if (name.length < 2 || o.ph.length > 24 || o.code.length > 12) return send(res, 400, { error: 'bad' });
        const ex = maps[key];
        if (ex && ex.ph !== o.ph) return send(res, 403, { error: 'wrong password' });
        if (!ex && Object.values(maps).some(m => m.code === o.code)) return send(res, 409, { error: 'code taken' });
        const tiles = validTiles(o.tiles) ? o.tiles : (ex ? ex.tiles : []);
        maps[key] = { name, ph: o.ph, code: o.code, tiles, t: Date.now() };
        save();
        send(res, 200, { ok: true });
      });
    }
    if (req.method === 'GET') {
      const q = (u.searchParams.get('q') || '').trim().toLowerCase(), ph = u.searchParams.get('ph') || '';
      const m = maps[q] || Object.values(maps).find(x => x.code.toLowerCase() === q);
      if (!m) return send(res, 404, { error: 'not found' });
      if (m.ph !== ph) return send(res, 403, { error: 'wrong password' });
      return send(res, 200, { name: m.name, ph: m.ph, code: m.code, tiles: m.tiles });
    }
  }

  if (u.pathname === '/' || u.pathname === '/index.html') {
    return fs.readFile(INDEX, (e, buf) => {
      if (e) { res.writeHead(500); return res.end('Thiếu public/index.html'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  }
  res.writeHead(404); res.end('Not found');
});

// ---------- phòng online (WebSocket) ----------
// Giao thức khớp với client: join {room,id} · pres {s} · emit {topic,data}  →  peers {list} · emit {topic,data}
const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });
const rooms = new Map(); // tên phòng -> { c:Set<ws>, p:Map<id,presence>, d:bool }
const MAX_PER_ROOM = 16;

wss.on('connection', ws => {
  ws.alive = true; ws.rid = null; ws.room = null; ws.rn = null;
  let cnt = 0, win = Date.now();
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    const now = Date.now();
    if (now - win > 1000) { win = now; cnt = 0; }
    if (++cnt > 80) return; // chống spam
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join' && !ws.room) {
      const rn = String(m.room || '').slice(0, 60), id = String(m.id || '').slice(0, 16);
      if (!rn || !id) return;
      let r = rooms.get(rn);
      if (!r) { r = { c: new Set(), p: new Map(), d: false }; rooms.set(rn, r); }
      if (r.c.size >= MAX_PER_ROOM) return ws.close(1013, 'room full');
      r.c.add(ws); ws.room = r; ws.rn = rn; ws.rid = id; r.d = true;
    } else if (!ws.room) return;
    else if (m.t === 'pres' && m.s && typeof m.s === 'object') { m.s.id = ws.rid; ws.room.p.set(ws.rid, m.s); ws.room.d = true; }
    else if (m.t === 'emit' && typeof m.topic === 'string') {
      const out = JSON.stringify({ t: 'emit', topic: m.topic.slice(0, 24), data: m.data });
      for (const c of ws.room.c) if (c !== ws && c.readyState === 1) c.send(out);
    }
  });
  ws.on('close', () => {
    const r = ws.room; if (!r) return;
    r.c.delete(ws);
    if (![...r.c].some(c => c.rid === ws.rid)) { r.p.delete(ws.rid); r.d = true; }
    if (!r.c.size) rooms.delete(ws.rn);
  });
  ws.on('error', () => {});
});

// gửi danh sách người chơi mỗi 100ms (gộp, tránh n² tin nhắn)
setInterval(() => {
  for (const r of rooms.values()) {
    if (!r.d) continue; r.d = false;
    const out = JSON.stringify({ t: 'peers', list: [...r.p.values()] });
    for (const c of r.c) if (c.readyState === 1) c.send(out);
  }
}, 100);

// giữ kết nối sống qua proxy của Render + dọn kết nối chết
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; try { ws.ping(); } catch (e) {}
  }
}, 25000);

server.listen(PORT, () => console.log('RAFT server chạy ở cổng ' + PORT));
