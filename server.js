const express = require('express');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;
const wsPort = process.env.WS_PORT || 8080;

app.set('trust proxy', 1); // For HTTPS detection
// Listen on dynamic port
app.listen(port, '0.0.0.0', () => {  // Bind to all interfaces
  console.log(`Server at http://0.0.0.0:${port}`);
});


// Basic Auth Middleware
const requireAuth = (req, res, next) => {
  const auth = { login: 'admin', password: 'stream' }; // Change these!
  
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
  
  if (login && password && login === auth.login && password === auth.password) {
    return next();
  } else {
    res.set('WWW-Authenticate', 'Basic realm="MP3 Admin"');
    return res.status(401).send('Authentication required');
  }
};

// Apply auth to admin routes only
app.use('/api/files', requireAuth);
app.use('/admin', requireAuth);
app.use('/admin/start', requireAuth);
app.use('/admin/stop', requireAuth);

// Serve static files
app.use(express.static('public'));
app.use('/audio', express.static(path.join(__dirname, 'audio')));

let currentStream = null; // Track active stream
let wss = null;

// WebSocket server (works behind proxies)
const initWebSocket = () => {
  wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});
  
};





initWebSocket();

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));

app.get('/admin/start', requireAuth, (req, res) => {
  const file = req.query.file;
  if (!file || !fs.existsSync(path.join('audio', file))) {
    return res.status(400).send('Invalid file');
  }
  
  // Clear existing stream AND notify clients
  if (currentStream) {
    currentStream.destroy();
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'clear' }));
      }
    });
  }
  
  currentStream = fs.createReadStream(path.join('audio', file));
  
  currentStream.on('data', (chunk) => {
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(chunk);
      }
    });
  });
  
  currentStream.on('end', () => { 
    currentStream = null;
    // Send end signal
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'end' }));
      }
    });
  });
  
  res.send('Stream started: ' + file);
});

app.get('/admin/stop', requireAuth, (req, res) => {
  if (currentStream) {
    currentStream.destroy();
    currentStream = null;
  }
  
  // CRITICAL: Tell ALL players to stop immediately
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: 'clear' }));
    }
  });
  
  res.send('Stream stopped');
});


app.get('/api/files', (req, res) => {
  const audioDir = path.join(__dirname, 'audio');
  fs.readdir(audioDir, (err, files) => {
    if (err) return res.status(500).json([]);
    const mp3s = files.filter(f => f.endsWith('.mp3')).map(f => `/audio/${f}`);
    res.json(mp3s);
  });
});
//app.use('/audio', express.static(path.join(__dirname, 'audio')));


app.listen(port, () => console.log(`Server at http://localhost:${port}`));



