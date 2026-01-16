import express from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';

const app = express();
const N8N_TARGET = process.env.N8N_TARGET_URL || 'http://34.174.95.102:5678';

// Parse JSON body for Box event routing
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', target: N8N_TARGET });
});

// Box event trigger to n8n webhook path mapping
const TRIGGER_ROUTES = {
  'FILE.UPLOADED': 'box-file-upload',
  'METADATA_INSTANCE.CREATED': 'box-metadata',
  'METADATA_INSTANCE.UPDATED': 'box-metadata',
  'METADATA_INSTANCE.DELETED': 'box-metadata',
  'TASK_ASSIGNMENT.CREATED': 'box-tasks',
  'TASK_ASSIGNMENT.UPDATED': 'box-tasks',
  'SIGN_REQUEST.COMPLETED': 'box-sign',
  'SIGN_REQUEST.DECLINED': 'box-sign',
  'SIGN_REQUEST.EXPIRED': 'box-sign',
  'COLLABORATION.CREATED': 'box-collab',
  'COLLABORATION.REMOVED': 'box-collab'
};

// Box webhook dispatcher - routes events to appropriate n8n workflow
app.post('/webhook/box-file-upload', (req, res, next) => {
  const trigger = req.body?.trigger;

  if (trigger && TRIGGER_ROUTES[trigger] && TRIGGER_ROUTES[trigger] !== 'box-file-upload') {
    // Route to appropriate workflow based on trigger type
    const targetPath = `/webhook/${TRIGGER_ROUTES[trigger]}`;
    console.log(`Routing ${trigger} event to ${targetPath}`);
    req.url = targetPath;
  }

  next();
});

// Proxy all webhook requests to n8n
app.use('/webhook', createProxyMiddleware({
  target: N8N_TARGET,
  changeOrigin: true,
  logLevel: 'warn',
  onProxyReq: (proxyReq, req) => {
    console.log(`Proxying ${req.method} ${req.url} to ${N8N_TARGET}`);
    // Fix request body after express.json() parsing
    fixRequestBody(proxyReq, req);
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err.message);
    res.status(502).json({ error: 'Proxy error', message: err.message });
  }
}));

// Proxy API requests
app.use('/api', createProxyMiddleware({
  target: N8N_TARGET,
  changeOrigin: true,
  logLevel: 'warn'
}));

// Proxy REST requests
app.use('/rest', createProxyMiddleware({
  target: N8N_TARGET,
  changeOrigin: true,
  logLevel: 'warn'
}));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`n8n HTTPS Proxy running on port ${PORT}`);
  console.log(`Proxying to: ${N8N_TARGET}`);
});
