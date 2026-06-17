require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';

app.use(cors());
app.use(express.json());

// Serve static files from the Vite build output
const distPath = path.resolve(__dirname, 'dist');
app.use(express.static(distPath));

// Forward API requests to the gateway
async function forwardRequest(req, res, targetPath, method) {
  const url = `${GATEWAY_URL}${targetPath}`;
  const options = {
    method: method || req.method,
    headers: {
      'Content-Type': 'application/json',
    },
  };
  if (req.body && Object.keys(req.body).length > 0) {
    options.body = JSON.stringify(req.body);
  }
  try {
    const response = await fetch(url, options);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Gateway request failed', details: error.message });
  }
}

// Health check
app.get('/api/health', (req, res) => {
  forwardRequest(req, res, '/health', 'GET');
});

// Create session
app.post('/api/session/create', (req, res) => {
  forwardRequest(req, res, '/session/create', 'POST');
});

// Chat
app.post('/api/session/:id/chat', (req, res) => {
  const { id } = req.params;
  forwardRequest(req, res, `/session/${id}/chat`, 'POST');
});

// Close session
app.post('/api/session/:id/close', (req, res) => {
  const { id } = req.params;
  forwardRequest(req, res, `/session/${id}/close`, 'POST');
});

// List sessions
app.get('/api/sessions', (req, res) => {
  forwardRequest(req, res, '/sessions', 'GET');
});

// For any non-API route, serve the React app
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SeekCode GUI running at http://localhost:${PORT}`);
  console.log(`Proxying to gateway at ${GATEWAY_URL}`);
  console.log(`Serving static files from ${distPath}`);
});
