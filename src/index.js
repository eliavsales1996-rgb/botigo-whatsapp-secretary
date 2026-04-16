'use strict';

require('dotenv').config();
const express = require('express');
const webhookRouter = require('./webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse Twilio's URL-encoded webhook payloads
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// WhatsApp webhook
app.use('/webhook', webhookRouter);

// Global 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(`[${new Date().toISOString()}] Unhandled error:`, err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Process-level safety net
process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] Uncaught Exception:`, err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[${new Date().toISOString()}] Unhandled Rejection:`, reason);
});

app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Legal AI Secretary running on port ${PORT}`);
  console.log(`  Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
});
