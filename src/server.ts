import fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyFormbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { twilioService } from './services/twilio.service.js';
import { RealtimeVoiceSession } from './services/realtime.service.js';
import { dbService } from './db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = fastify({ logger: true });

// Register Plugins
await app.register(fastifyCors, { origin: true });
await app.register(fastifyFormbody);
await app.register(fastifyWebsocket);

// Serve static dashboard files
await app.register(fastifyStatic, {
  root: path.join(__dirname, '../public'),
  prefix: '/'
});

// --- Webhook: Twilio Incoming Voice Call ---
app.post('/twiml/incoming', async (req, reply) => {
  const body = req.body as Record<string, string>;
  const callSid = body.CallSid || `inc_${Date.now()}`;
  const fromNumber = body.From || 'Unknown';
  const toNumber = body.To || config.twilio.phoneNumber;

  console.log(`[Twilio Webhook] Incoming call received from ${fromNumber} (CallSid: ${callSid})`);

  // Record call in DB
  dbService.createCall({
    call_sid: callSid,
    direction: 'inbound',
    from_number: fromNumber,
    to_number: toNumber,
    status: 'in-progress'
  });

  // Automatically update contacts
  dbService.upsertContact(fromNumber);

  // Generate WebSocket media stream URL
  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
  const streamUrl = `${protocol}://${host}/ws/media-stream`;

  // Respond with TwiML
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="callerPhone" value="${fromNumber}" />
      <Parameter name="direction" value="inbound" />
    </Stream>
  </Connect>
</Response>`;

  reply.header('Content-Type', 'text/xml').send(twiml);
});

// --- Webhook: Twilio Outbound Call Connected ---
app.post('/twiml/outbound', async (req, reply) => {
  const body = req.body as Record<string, string>;
  const callSid = body.CallSid || `out_${Date.now()}`;
  const toNumber = body.To || 'Unknown';

  console.log(`[Twilio Webhook] Outbound call connected to ${toNumber} (CallSid: ${callSid})`);

  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
  const streamUrl = `${protocol}://${host}/ws/media-stream`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="callerPhone" value="${toNumber}" />
      <Parameter name="direction" value="outbound" />
    </Stream>
  </Connect>
</Response>`;

  reply.header('Content-Type', 'text/xml').send(twiml);
});

// --- Twilio Call Status Callback ---
app.post('/api/calls/status', async (req, reply) => {
  const body = req.body as Record<string, string>;
  const callSid = body.CallSid;
  const callStatus = body.CallStatus;
  const callDuration = body.CallDuration ? parseInt(body.CallDuration, 10) : undefined;

  console.log(`[Twilio Status] Call ${callSid} status changed: ${callStatus}`);
  if (callSid) {
    dbService.updateCallStatus(callSid, callStatus, callDuration);
  }

  reply.send({ received: true });
});

// --- WebSocket Route for Bi-Directional Media Stream ---
app.get('/ws/media-stream', { websocket: true }, (ws: any) => {
  console.log('[WebSocket] Twilio Media Stream client connected.');
  const socket = ws.socket || ws;
  const session = new RealtimeVoiceSession(socket);

  socket.on('message', (message: any) => {
    session.handleTwilioMessage(message);
  });

  socket.on('close', () => {
    console.log('[WebSocket] Twilio Media Stream client disconnected.');
    session.endSession();
  });
});

// --- REST API: Trigger Outbound Call ---
app.post('/api/calls/outbound', async (req, reply) => {
  const { to } = req.body as { to: string };

  if (!to) {
    return reply.status(400).send({ error: 'Destination phone number "to" is required.' });
  }

  if (!config.twilio.accountSid || !config.twilio.authToken || !config.twilio.phoneNumber) {
    return reply.status(400).send({
      error: 'Twilio is not yet configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env'
    });
  }

  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const outboundTwimlUrl = config.publicUrl 
    ? `${config.publicUrl}/twiml/outbound` 
    : `${protocol}://${host}/twiml/outbound`;

  try {
    const call = await twilioService.makeOutboundCall(to, outboundTwimlUrl);

    dbService.createCall({
      call_sid: call.sid,
      direction: 'outbound',
      from_number: config.twilio.phoneNumber,
      to_number: to,
      status: 'queued'
    });

    dbService.upsertContact(to);

    return reply.send({
      success: true,
      message: `Outbound call placed to ${to}`,
      callSid: call.sid
    });
  } catch (err: any) {
    console.error('[Outbound Call Error]', err);
    return reply.status(500).send({ error: err.message });
  }
});

// --- REST API: Get All Calls ---
app.get('/api/calls', async () => {
  return dbService.getAllCalls();
});

// --- REST API: Get Single Call with Transcript & Analysis ---
app.get('/api/calls/:sid', async (req, reply) => {
  const { sid } = req.params as { sid: string };
  const call = dbService.getCallBySid(sid);
  if (!call) {
    return reply.status(404).send({ error: 'Call not found' });
  }
  return call;
});

// --- REST API: Appointments ---
app.get('/api/appointments', async () => {
  return dbService.getAllAppointments();
});

// --- REST API: Contacts / CRM ---
app.get('/api/contacts', async () => {
  return dbService.getAllContacts();
});

// --- REST API: System Status & Config ---
app.get('/api/status', async () => {
  return {
    openaiConfigured: !!config.openai.apiKey,
    twilioConfigured: twilioService.isConfigured(),
    twilioNumber: config.twilio.phoneNumber || 'Not configured',
    model: config.openai.realtimeModel,
    voice: config.openai.voice,
    publicUrl: config.publicUrl || 'Localhost (Needs tunnel/domain for carrier calls)'
  };
});

// --- REST API: Update System Prompt ---
app.post('/api/config/prompt', async (req, reply) => {
  const { prompt } = req.body as { prompt: string };
  if (!prompt) {
    return reply.status(400).send({ error: 'Prompt is required.' });
  }
  config.openai.systemPrompt = prompt;
  return reply.send({ success: true, message: 'System prompt updated successfully.' });
});

// Start Server
const start = async () => {
  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`\n======================================================`);
    console.log(`🚀 AI Voice Caller Server running at http://${config.host}:${config.port}`);
    console.log(`📡 Inbound Webhook:  http://${config.host}:${config.port}/twiml/incoming`);
    console.log(`📞 Outbound Webhook: http://${config.host}:${config.port}/twiml/outbound`);
    console.log(`🎙️ WebSocket Stream: ws://${config.host}:${config.port}/ws/media-stream`);
    console.log(`======================================================\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
