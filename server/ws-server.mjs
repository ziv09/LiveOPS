import http from 'node:http'
import { WebSocketServer } from 'ws'

const port = Number.parseInt(process.env.SIGNAL_PORT ?? '8787', 10)
const host = process.env.SIGNAL_HOST ?? '0.0.0.0'

/** @type {Map<string, any>} */
const roomState = new Map()
/** @type {Map<string, Set<import('ws').WebSocket>>} */
const roomClients = new Map()

function getRoom(room) {
  return (room ?? '').toString().trim() || 'liveops-demo'
}

function broadcast(room, payload) {
  const clients = roomClients.get(room)
  if (!clients) return
  const data = JSON.stringify(payload)
  for (const ws of clients) {
    try {
      if (ws.readyState === ws.OPEN) ws.send(data)
    } catch {
      // noop
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }
  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
  /** @type {string | null} */
  let subscribedRoom = null

  ws.on('message', (buf) => {
    let msg
    try {
      msg = JSON.parse(buf.toString('utf8'))
    } catch {
      return
    }

    if (msg?.type === 'subscribe') {
      const room = getRoom(msg.room)
      subscribedRoom = room
      if (!roomClients.has(room)) roomClients.set(room, new Set())
      roomClients.get(room).add(ws)
      ws.send(JSON.stringify({ type: 'state', state: roomState.get(room) ?? null }))
      return
    }

    if (msg?.type === 'set') {
      const room = getRoom(msg.room)
      const incoming = msg.state
      if (!incoming || incoming.v !== 1) return
      if (incoming?.session?.opsId !== room) return
      if (incoming?.routing?.opsId !== room) return

      const prev = roomState.get(room)
      const prevUpdatedAt = typeof prev?.updatedAt === 'number' ? prev.updatedAt : 0
      const nextUpdatedAt = typeof incoming?.updatedAt === 'number' ? incoming.updatedAt : 0
      if (nextUpdatedAt <= prevUpdatedAt) return

      roomState.set(room, incoming)
      broadcast(room, { type: 'state', state: incoming })
      return
    }
  })

  ws.on('close', () => {
    if (!subscribedRoom) return
    const set = roomClients.get(subscribedRoom)
    if (!set) return
    set.delete(ws)
    if (set.size === 0) roomClients.delete(subscribedRoom)
  })
})

server.listen(port, host, () => {
  console.log(`[liveops-signal] ws listening on ws://${host}:${port}`)
})
