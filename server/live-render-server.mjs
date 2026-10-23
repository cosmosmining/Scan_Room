// MOZU LIVE — browser bridge for the EEVEE pixel-streaming engine.
//
// The real engine is scripts/ios/blender_stream_server.py: Blender itself is a raw
// TCP server that renders a near-photoreal EEVEE frame per camera pose. The iPad
// connects to that TCP socket directly (lowest latency). THIS Node process is only a
// convenience so you can test the exact same stream in a BROWSER on the Mac: it
// serves a WASD/mouse viewport and bridges its HTTP calls to Blender's TCP socket.
//
//   1) start the engine:   server/run-live.sh
//   2) open the viewport:  http://localhost:8788/live   (walk with W/A/S/D + drag)
//
// Env: PORT (http, default 8788) · MOZU_STREAM_HOST/PORT (Blender TCP, default
// 127.0.0.1:8080) · MOZU_SAMPLE (default scene when the browser sends none).

import http from 'node:http'
import net from 'node:net'
import { readFile } from 'node:fs/promises'

const PORT = Number(process.env.PORT || 8788)
const STREAM_HOST = process.env.MOZU_STREAM_HOST || '127.0.0.1'
const STREAM_PORT = Number(process.env.MOZU_STREAM_PORT || 8080)
const SAMPLE = process.env.MOZU_SAMPLE || 'server/sample-request.json'

// ── one lockstep TCP connection to the Blender engine ──
let tcp = null
let rxBuf = Buffer.alloc(0)
let rxWaiter = null
let chain = Promise.resolve()

function connect() {
  return new Promise((resolve, reject) => {
    const s = net.connect(STREAM_PORT, STREAM_HOST, () => { tcp = s; resolve(s) })
    s.setNoDelay(true)
    s.on('data', (chunk) => {
      rxBuf = Buffer.concat([rxBuf, chunk])
      while (rxBuf.length >= 4) {
        const n = rxBuf.readUInt32BE(0)
        if (rxBuf.length < 4 + n) break
        const frame = Buffer.from(rxBuf.subarray(4, 4 + n))
        rxBuf = rxBuf.subarray(4 + n)
        const w = rxWaiter; rxWaiter = null
        if (w) w(frame)
      }
    })
    s.on('error', (e) => { tcp = null; reject(e) })
    s.on('close', () => { tcp = null })
  })
}

// Send one length-prefixed JSON message, resolve with the length-prefixed JPEG reply.
function request(obj) {
  const run = () => new Promise(async (resolve, reject) => {
    try {
      if (!tcp) await connect()
      const body = Buffer.from(JSON.stringify(obj), 'utf8')
      const head = Buffer.alloc(4); head.writeUInt32BE(body.length, 0)
      const timer = setTimeout(() => { if (rxWaiter) { rxWaiter = null; reject(new Error('engine timed out')) } }, 120_000)
      rxWaiter = (frame) => { clearTimeout(timer); resolve(frame) }
      tcp.write(Buffer.concat([head, body]))
    } catch (e) { reject(e) }
  })
  const p = chain.then(run)
  chain = p.catch(() => {})
  return p
}

function readBody(req) {
  return new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))) })
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, connected: !!tcp })) }
    if (req.method === 'GET' && (req.url === '/live' || req.url === '/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(VIEWPORT_HTML)
    }
    if (req.method === 'POST' && req.url === '/live/scene') {
      const body = (await readBody(req)).toString('utf8').trim()
      const design = body.length ? JSON.parse(body) : JSON.parse(await readFile(SAMPLE, 'utf8'))
      await request({ t: 'scene', design, cam: { pos: [1.8, 1.5, 1.4], target: [1.8, 1.5, 0], fov: 62, w: 640, h: 400 } })
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true }))
    }
    if (req.method === 'POST' && req.url === '/live/frame') {
      const cam = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      const jpg = await request({ t: 'pose', ...cam })
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': jpg.length, 'cache-control': 'no-store' }); return res.end(jpg)
    }
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('MOZU Live bridge — GET /live')
  } catch (err) {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
    res.end(`live bridge error: ${err.message} (is the engine running? server/run-live.sh)`)
  }
})
server.on('error', (e) => { if (e.code === 'EADDRINUSE') { console.error(`Port ${PORT} in use: lsof -ti :${PORT} | xargs kill`); process.exit(1) } throw e })
server.listen(PORT, () => console.log(`MOZU Live bridge on http://localhost:${PORT}/live → engine ${STREAM_HOST}:${STREAM_PORT}`))

const VIEWPORT_HTML = `<!doctype html><meta charset=utf-8><title>MOZU Live</title>
<meta name=viewport content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#111;overflow:hidden;font:14px -apple-system,system-ui,sans-serif;color:#eee}
#v{width:100vw;height:100vh;object-fit:cover;display:block;cursor:grab}#v:active{cursor:grabbing}
#hud{position:fixed;top:12px;left:12px;background:rgba(0,0,0,.55);padding:8px 12px;border-radius:8px;line-height:1.5}
#hud b{color:#8ad}kbd{background:#333;border-radius:4px;padding:1px 5px;margin:0 1px}</style>
<img id=v alt="building scene…"><div id=hud><b>MOZU Live</b> · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · drag to look · <span id=fps>…</span></div>
<script>
const img=document.getElementById('v'),fpsEl=document.getElementById('fps');
let cam={x:1.8,y:1.5,z:1.4,yaw:3.14,pitch:-0.05},keys={},drag=0,lx=0,ly=0;
addEventListener('keydown',e=>keys[e.key.toLowerCase()]=1);addEventListener('keyup',e=>keys[e.key.toLowerCase()]=0);
img.addEventListener('pointerdown',e=>{drag=1;lx=e.clientX;ly=e.clientY;img.setPointerCapture(e.pointerId)});
img.addEventListener('pointerup',()=>drag=0);
img.addEventListener('pointermove',e=>{if(!drag)return;cam.yaw-=(e.clientX-lx)*0.005;cam.pitch=Math.max(-1.4,Math.min(1.4,cam.pitch-(e.clientY-ly)*0.005));lx=e.clientX;ly=e.clientY});
function move(dt){const s=1.8*dt,fx=Math.sin(cam.yaw),fz=Math.cos(cam.yaw);
 if(keys.w){cam.x-=fx*s;cam.z-=fz*s}if(keys.s){cam.x+=fx*s;cam.z+=fz*s}if(keys.a){cam.x-=fz*s;cam.z+=fx*s}if(keys.d){cam.x+=fz*s;cam.z-=fx*s}}
function pose(){const cp=Math.cos(cam.pitch);return{pos:[cam.x,cam.y,cam.z],
 target:[cam.x-Math.sin(cam.yaw)*cp,cam.y+Math.sin(cam.pitch),cam.z-Math.cos(cam.yaw)*cp],fov:62,w:960,h:600}}
let last=performance.now(),t0=last,n=0;
(async()=>{await fetch('/live/scene',{method:'POST'});loop()})();
async function loop(){const now=performance.now();move(Math.min((now-last)/1000,0.05));last=now;
 try{const r=await fetch('/live/frame',{method:'POST',body:JSON.stringify(pose())});
  if(r.ok){const u=URL.createObjectURL(await r.blob());img.onload=()=>URL.revokeObjectURL(u);img.src=u;
   if(++n>=5){fpsEl.textContent=(n*1000/(now-t0)).toFixed(1)+' fps';n=0;t0=now}}else img.alt='engine '+r.status
 }catch(e){img.alt='bridge offline'}
 requestAnimationFrame(loop)}
</script>`
