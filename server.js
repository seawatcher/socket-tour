const express = require('express');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.set('trust proxy', 1);

const requireAuth = (req, res, next) => {
  const auth = {
    login: process.env.ADMIN_LOGIN || 'admin',
    password: process.env.ADMIN_PASSWORD || 'stream'
  };
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
  if (login && password && login === auth.login && password === auth.password) return next();
  res.set('WWW-Authenticate', 'Basic realm="MP3 Admin"');
  return res.status(401).send('Authentication required');
};

app.use('/api/files', requireAuth);
app.use('/admin', requireAuth);
app.use('/admin/start', requireAuth);
app.use('/admin/stop', requireAuth);
app.use('/admin/reset', requireAuth);

app.use(express.static('public'));
app.use('/audio', express.static(path.join(__dirname, 'audio')));

let currentStream = null;
let currentFile = null;
let isStreaming = false;
let wss = null;

const broadcast = (payload, isBinary = false) => {
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(isBinary ? payload : JSON.stringify(payload));
    }
  });
};

const stopStream = () => {
  if (!currentStream) return;
  currentStream.pause();
  isStreaming = false;
  broadcast({ type: 'pause' });
};

const resetStream = () => {
  if (currentStream) {
    currentStream.destroy();
    currentStream = null;
  }
  currentFile = null;
  isStreaming = false;
  broadcast({ type: 'clear' });
};

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on ${port}`);
});

const initWebSocket = () => {
  wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws') {
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    } else socket.destroy();
  });

  wss.on('connection', ws => {
    console.log('WS client connected');
    ws.on('error', err => console.error('WS error:', err));
    ws.on('close', () => console.log('WS client disconnected'));
  });
};
initWebSocket();

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));

app.get('/admin/start', requireAuth, (req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).send('file missing');
  const filePath = path.join(__dirname, 'audio', file);
  if (!fs.existsSync(filePath)) return res.status(400).send('file not found');

  if (currentFile === file && currentStream) {
    // se il flusso esiste ed è fermo, riattiva
    if (!isStreaming) {
      currentStream.resume();
    }
    isStreaming = true;
    broadcast({ type: 'resume' });
    return res.send(`Resumed ${file}`);
  }

  // cambio file -> reset e nuovo stream
  resetStream();
  currentFile = file;

  currentStream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
  currentStream.on('data', chunk => {
    if (!isStreaming) return;
    broadcast(chunk, true);
  });

  currentStream.on('end', () => {
    isStreaming = false;
    currentStream = null;
    broadcast({ type: 'end' });
  });

  currentStream.on('error', err => {
    console.error('read stream error:', err);
    isStreaming = false;
    currentStream = null;
    broadcast({ type: 'error', message: 'stream error' });
  });

  isStreaming = true;
  broadcast({ type: 'start', file });
  res.send(`Streaming ${file}`);
});

app.get('/admin/stop', requireAuth, (req, res) => {
  if (!currentStream || !isStreaming) return res.send('Not currently streaming');
  stopStream();
  res.send(`Paused ${currentFile}`);
});

app.get('/admin/reset', requireAuth, (req, res) => {
  resetStream();
  res.send('Reset stream and cleared clients');
});

app.get('/api/files', (req, res) => {
  const audioDir = path.join(__dirname, 'audio');
  fs.readdir(audioDir, (err, files) => {
    if (err) return res.status(500).json([]);
    const mp3s = files.filter(f => f.endsWith('.mp3')).map(f => `/audio/${f}`);
    res.json(mp3s);
  });
});