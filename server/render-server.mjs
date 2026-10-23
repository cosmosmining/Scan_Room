// MOZU photoreal render server.
//
// Receives a design (the user's scanned room + placed furniture) from the iPad app
// as JSON, runs Blender Cycles (scripts/ios/blender_render_design.py) to path-trace
// it, and returns the resulting PNG. Pure Node built-ins — no npm install needed.
//
//   node server/render-server.mjs
//
// Environment:
//   PORT          HTTP port                              (default 8787)
//   MOZU_PYTHON   python with the `bpy` module installed (default "python3")
//                 — OR set MOZU_BLENDER to a Blender binary to use "--background".
//   MOZU_BLENDER  path to a Blender executable           (optional; overrides MOZU_PYTHON)
//   MOZU_SCRIPT   path to blender_render_design.py       (default scripts/ios/blender_render_design.py)
//   MOZU_MODELS   USDZ models dir                        (default apps/ios/MozuScanner/Resources/Models)
//   MOZU_TEX      textures dir                           (default apps/ios/MozuScanner/Resources/Textures)
//   MOZU_TIMEOUT  render timeout ms                      (default 600000)
//
// Endpoints:
//   GET  /health  → {"ok":true}
//   POST /render  → body = mozu.render/1 JSON; responds image/png (or 500 + text)

import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = Number(process.env.PORT || 8787)
const PYTHON = process.env.MOZU_PYTHON || 'python3'
const BLENDER = process.env.MOZU_BLENDER || ''
const SCRIPT = process.env.MOZU_SCRIPT || 'scripts/ios/blender_render_design.py'
const MODELS = process.env.MOZU_MODELS || 'apps/ios/MozuScanner/Resources/Models'
const TEX = process.env.MOZU_TEX || 'apps/ios/MozuScanner/Resources/Textures'
const TIMEOUT = Number(process.env.MOZU_TIMEOUT || 600_000)
const MAX_BODY = 8 * 1024 * 1024 // 8 MB request cap

/** Build the argv to invoke the Blender worker. */
function renderCommand(reqPath, outPath) {
  if (BLENDER) {
    // Blender binary: blender --background --python script.py -- req out models tex
    return [BLENDER, ['--background', '--python', SCRIPT, '--', reqPath, outPath, MODELS, TEX]]
  }
  // python with the bpy module: python3 script.py -- req out models tex
  return [PYTHON, [SCRIPT, '--', reqPath, outPath, MODELS, TEX]]
}

/** Run one render. Resolves to the PNG buffer, rejects with an Error (+ .log). */
async function renderDesign(design) {
  const dir = await mkdtemp(join(tmpdir(), 'mozu-render-'))
  const reqPath = join(dir, 'request.json')
  const outPath = join(dir, 'render.png')
  await writeFile(reqPath, JSON.stringify(design))

  const [cmd, args] = renderCommand(reqPath, outPath)
  const started = Date.now()

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    const onData = (d) => { log += d.toString(); if (log.length > 64_000) log = log.slice(-64_000) }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)

    const killer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(Object.assign(new Error(`render timed out after ${TIMEOUT}ms`), { log }))
    }, TIMEOUT)

    child.on('error', (err) => {
      clearTimeout(killer)
      rm(dir, { recursive: true, force: true })
      reject(Object.assign(err, { log }))
    })

    child.on('close', async (code) => {
      clearTimeout(killer)
      try {
        if (code !== 0) throw new Error(`renderer exited ${code}`)
        const png = await readFile(outPath)
        console.log(`rendered ${png.length} bytes in ${Date.now() - started}ms`)
        resolve(png)
      } catch (err) {
        reject(Object.assign(err, { log }))
      } finally {
        rm(dir, { recursive: true, force: true })
      }
    })
  })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) { reject(new Error('request too large')); req.destroy() }
      else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, engine: BLENDER ? 'blender' : 'bpy' }))
    return
  }

  if (req.method === 'POST' && req.url === '/render') {
    try {
      const body = await readBody(req)
      const design = JSON.parse(body.toString('utf8'))
      const png = await renderDesign(design)
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length })
      res.end(png)
    } catch (err) {
      console.error('render failed:', err.message, '\n', err.log || '')
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(`render failed: ${err.message}\n\n${(err.log || '').slice(-4000)}`)
    }
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found — POST /render or GET /health')
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — another render server is running.`)
    console.error(`Stop it:  lsof -ti :${PORT} | xargs kill   (or run with a different PORT=…)`)
    process.exit(1)
  }
  throw err
})

server.listen(PORT, () => {
  console.log(`MOZU render server on :${PORT} (${BLENDER ? `blender=${BLENDER}` : `python=${PYTHON}`})`)
})
