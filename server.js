import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';

const app = express();
app.use(express.static('.'));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Simple 2-player rooms keyed by roomId
const rooms = new Map();

function createRoom(roomId) {
	const room = {
		id: roomId,
		players: new Map(), // ws -> { id, side: 'left'|'right', name }
		state: createInitialState(),
		lastTick: Date.now(),
		interval: null,
	};
	room.interval = setInterval(() => tickRoom(room), 1000 / 60);
	rooms.set(roomId, room);
	return room;
}

function createInitialState() {
	return {
		left: { x: 256, y: 288, vx: 0, vy: 0 },
		right: { x: 768, y: 288, vx: 0, vy: 0 },
		ball: { x: 512, y: 288, vx: 0, vy: 0 },
		leftScore: 0,
		rightScore: 0,
	};
}

function tickRoom(room) {
	// Integrate simple physics (server authoritative minimal): just integrate velocities and clamp
	const dt = 1 / 60;
	const s = room.state;
	for (const obj of [s.left, s.right, s.ball]) {
		obj.x += obj.vx * dt;
		obj.y += obj.vy * dt;
		obj.vx *= 0.98;
		obj.vy *= 0.98;
		obj.x = Math.max(30, Math.min(994, obj.x));
		obj.y = Math.max(30, Math.min(546, obj.y));
	}
	// Broadcast state
	const msg = JSON.stringify({ t: 'state', s });
	for (const ws of room.players.keys()) {
		if (ws.readyState === ws.OPEN) ws.send(msg);
	}
}

function assignSide(room) {
	const sides = new Set(['left', 'right']);
	for (const { side } of room.players.values()) sides.delete(side);
	return sides.values().next().value || null;
}

wss.on('connection', (ws, req) => {
	const url = new URL(req.url, 'http://localhost');
	const roomId = url.searchParams.get('room') || 'default';
	const name = url.searchParams.get('name') || 'Oyuncu';
	let room = rooms.get(roomId) || createRoom(roomId);
	const side = assignSide(room);
	if (!side) {
		ws.send(JSON.stringify({ t: 'full' }));
		ws.close();
		return;
	}
	room.players.set(ws, { id: Math.random().toString(36).slice(2, 8), side, name });
	ws.send(JSON.stringify({ t: 'join', side }));

	ws.on('message', (data) => {
		try {
			const msg = JSON.parse(data);
			if (msg.t === 'input' && (msg.side === 'left' || msg.side === 'right')) {
				// Apply input as velocity change
				const p = room.state[msg.side];
				const accel = 500;
				p.vx += (msg.dx || 0) * accel * (1 / 60);
				p.vy += (msg.dy || 0) * accel * (1 / 60);
				const sp = Math.hypot(p.vx, p.vy);
				const max = 200;
				if (sp > max) { const k = max / sp; p.vx *= k; p.vy *= k; }
			}
			if (msg.t === 'kick' && (msg.side === 'left' || msg.side === 'right')) {
				const p = room.state[msg.side];
				const b = room.state.ball;
				const dx = b.x - p.x, dy = b.y - p.y;
				const dist = Math.hypot(dx, dy);
				if (dist < 70) {
					const nx = dx / (dist || 1), ny = dy / (dist || 1);
					b.vx += nx * 600; b.vy += ny * 600;
				}
			}
		} catch {}
	});

	ws.on('close', () => {
		const info = room.players.get(ws);
		room.players.delete(ws);
		if (room.players.size === 0) {
			clearInterval(room.interval);
			rooms.delete(room.id);
		}
	});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server listening on http://localhost:' + PORT)); 