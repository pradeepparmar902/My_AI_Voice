import fastify from 'fastify';
import WebSocket from 'ws';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyFormbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { twilioService } from './services/twilio.service.js';
import { RealtimeVoiceSession } from './services/realtime.service.js';
import { dbService } from './db/database.js';
import { localSimulatorService } from './services/simulator.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = fastify({ logger: true });

export const debugLogs: string[] = [];
export function logDebug(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  debugLogs.push(line);
  if (debugLogs.length > 200) debugLogs.shift();
}

// Register Plugins
await app.register(fastifyCors, { origin: true });
await app.register(fastifyFormbody);
await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit
await app.register(fastifyWebsocket);

// Serve static dashboard files
await app.register(fastifyStatic, {
  root: path.join(__dirname, '../public'),
  prefix: '/'
});

// --- Health & Diagnostic Endpoint ---
app.get('/api/debug/health', async () => {
  const key = config.openai.apiKey || '';
  const keyInfo = {
    present: !!key,
    length: key.length,
    prefix: key.substring(0, 10),
    suffix: key.substring(key.length - 8)
  };

  try {
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${config.openai.realtimeModel}`, {
      headers: { Authorization: `Bearer ${key}` }
    });

    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { ws.terminate(); } catch (_) {}
        resolve({ status: 'timeout' });
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timer);
        try { ws.close(); } catch (_) {}
        resolve({ status: 'connected_ok' });
      });

      ws.on('error', (e: any) => {
        clearTimeout(timer);
        resolve({ status: 'error', error: e.message });
      });

      ws.on('close', (code: any, reason: any) => {
        clearTimeout(timer);
        resolve({ status: `closed_${code}`, reason: reason.toString() });
      });
    });

    return {
      version: 'GA-1.0.4',
      model: config.openai.realtimeModel,
      keyInfo,
      publicUrl: config.publicUrl,
      twilioConfigured: !!(config.twilio.accountSid && config.twilio.authToken && config.twilio.phoneNumber),
      openAiRealtimeTest: result
    };
  } catch (err: any) {
    return {
      version: 'GA-1.0.4',
      keyInfo,
      error: err.message
    };
  }
});

app.get('/api/debug/logs', async () => {
  return debugLogs;
});

// --- Webhook: Twilio Incoming Voice Call ---
app.post('/twiml/incoming', async (req, reply) => {
  const body = req.body as Record<string, string>;
  const callSid = body.CallSid || `inc_${Date.now()}`;
  const fromNumber = body.From || 'Unknown';
  const toNumber = body.To || config.twilio.phoneNumber;

  logDebug(`[Twilio Webhook] Incoming call received from ${fromNumber} (CallSid: ${callSid})`);

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

  // Generate WebSocket media stream URL (Must strictly be wss:// for Twilio)
  const base = config.publicUrl || `https://${req.headers.host}`;
  const streamUrl = base.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'wss://') + '/ws/media-stream';
  logDebug(`[Twilio Webhook] Inbound call streamUrl: ${streamUrl}`);

  // Respond with TwiML
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi">Welcome to Aura Smiles Dental Clinic. Connecting your call.</Say>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="callerPhone" value="${fromNumber}" />
      <Parameter name="direction" value="inbound" />
      <Parameter name="callSid" value="${callSid}" />
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

  logDebug(`[Twilio Webhook] Outbound call connected to ${toNumber} (CallSid: ${callSid})`);

  const base = config.publicUrl || `https://${req.headers.host}`;
  const streamUrl = base.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'wss://') + '/ws/media-stream';
  logDebug(`[Twilio Webhook] Outbound call streamUrl: ${streamUrl}`);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi">Connecting your call to Aura Dental Clinic.</Say>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="callerPhone" value="${toNumber}" />
      <Parameter name="direction" value="outbound" />
      <Parameter name="callSid" value="${callSid}" />
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
app.get('/ws/media-stream', { websocket: true }, (ws: any, req: any) => {
  const query = (req && req.query) ? req.query : {};
  logDebug(`[WebSocket] Twilio Media Stream connected. Query: ${JSON.stringify(query)}`);
  const socket = ws.socket || ws;
  const session = new RealtimeVoiceSession(socket, query);

  socket.on('message', (message: any) => {
    session.handleTwilioMessage(message);
  });

  socket.on('close', (code: any, reason: any) => {
    logDebug(`[WebSocket] Twilio Media Stream disconnected. Code: ${code}, Reason: ${reason}`);
    session.endSession();
  });
});

// --- REST API: Local Testing Simulator (Zero Accounts Needed) ---
app.post('/api/simulator/chat', async (req) => {
  const { callerPhone, callSid, userText, history } = req.body as {
    callerPhone: string;
    callSid: string;
    userText: string;
    history: any[];
  };

  const result = await localSimulatorService.processSimulatorTurn(
    callerPhone || '+1-LOCAL-TEST',
    callSid || `sim_${Date.now()}`,
    userText || '',
    history || []
  );

  return result;
});

app.post('/api/simulator/end', async (req) => {
  const { callSid, callerPhone, transcript, durationSeconds } = req.body as {
    callSid: string;
    callerPhone: string;
    transcript: string;
    durationSeconds: number;
  };

  const saved = localSimulatorService.finishSimulatedCall(
    callSid,
    callerPhone || '+1-LOCAL-TEST',
    transcript || '',
    durationSeconds || 10
  );

  return saved;
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

// --- REST API: Knowledge Base ---
app.get('/api/knowledge', async () => {
  return dbService.getAllKnowledge();
});

app.post('/api/knowledge', async (req, reply) => {
  const { title, content, category } = req.body as { title: string; content: string; category?: string };
  if (!title || !content) {
    return reply.status(400).send({ error: 'Title and content are required.' });
  }

  const created = dbService.addKnowledge({
    title,
    content,
    category: category || 'General'
  });

  return reply.send({ success: true, item: created });
});

// Upload knowledge document file (.txt, .md, .json, .csv)
app.post('/api/knowledge/upload', async (req, reply) => {
  const file = await req.file();
  if (!file) {
    return reply.status(400).send({ error: 'No file uploaded.' });
  }

  const filename = file.filename;
  const buffer = await file.toBuffer();
  const content = buffer.toString('utf-8');

  // Strip extension for title
  const title = filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

  const created = dbService.addKnowledge({
    title,
    content,
    category: 'Uploaded File'
  });

  return reply.send({ success: true, item: created });
});

app.delete('/api/knowledge/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const deleted = dbService.deleteKnowledge(id);
  if (!deleted) {
    return reply.status(404).send({ error: 'Article not found.' });
  }
  return reply.send({ success: true });
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
