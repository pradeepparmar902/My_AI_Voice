import WebSocket from 'ws';
import { config } from '../config.js';
import { voiceTools, executeTool } from './tools.service.js';
import { dbService } from '../db/database.js';
import { summaryService } from './summary.service.js';
import { knowledgeService } from './knowledge.service.js';

interface StreamSession {
  streamSid: string;
  callSid: string;
  callerPhone: string;
  direction: 'inbound' | 'outbound';
  openAiWs: WebSocket | null;
  twilioWs: WebSocket;
  transcriptEntries: Array<{ speaker: 'user' | 'assistant'; text: string; time: string }>;
  startTime: number;
}

export class RealtimeVoiceSession {
  private session: StreamSession;

  constructor(twilioWs: WebSocket, initialParams?: any) {
    this.session = {
      streamSid: '',
      callSid: initialParams?.callSid || '',
      callerPhone: initialParams?.callerPhone || 'Unknown',
      direction: initialParams?.direction || 'inbound',
      openAiWs: null,
      twilioWs,
      transcriptEntries: [],
      startTime: Date.now()
    };

    // Early-initialize OpenAI Realtime so audio starts instantly without lag
    if (this.session.callerPhone && this.session.callerPhone !== 'Unknown') {
      this.initOpenAiSession();
    }
  }

  public handleTwilioMessage(message: WebSocket.RawData) {
    try {
      const data = JSON.parse(message.toString());

      switch (data.event) {
        case 'connected': {
          console.log('[Voice Session] Twilio media stream connected.');
          if (!this.session.openAiWs) {
            this.initOpenAiSession();
          }
          break;
        }

        case 'start': {
          this.session.streamSid = data.start.streamSid;
          if (data.start.callSid) {
            this.session.callSid = data.start.callSid;
          }

          const customParams = data.start.customParameters || {};
          if (customParams.callerPhone && this.session.callerPhone === 'Unknown') {
            this.session.callerPhone = customParams.callerPhone;
          }
          if (customParams.direction) {
            this.session.direction = customParams.direction;
          }

          console.log(`[Voice Session] Twilio Stream started. StreamSid: ${this.session.streamSid}, CallSid: ${this.session.callSid}, Phone: ${this.session.callerPhone}`);
          if (!this.session.openAiWs) {
            this.initOpenAiSession();
          } else if (this.session.openAiWs.readyState === WebSocket.OPEN) {
            this.configureSession();
          }
          break;
        }

        case 'media': {
          if (this.session.openAiWs && this.session.openAiWs.readyState === WebSocket.OPEN) {
            const audioAppendEvent = {
              type: 'input_audio_buffer.append',
              audio: data.media.payload // Base64 g711_ulaw chunk directly from Twilio
            };
            this.session.openAiWs.send(JSON.stringify(audioAppendEvent));
          }
          break;
        }

        case 'stop': {
          console.log(`[Voice Session] Twilio Stream stopped for CallSid: ${this.session.callSid}`);
          this.endSession();
          break;
        }

        default:
          console.log(`[Voice Session] Twilio event: ${data.event}`);
          break;
      }
    } catch (err) {
      console.error('[Voice Session] Error handling Twilio message:', err);
    }
  }

  private initOpenAiSession() {
    if (!config.openai.apiKey) {
      console.warn('[Voice Session] OPENAI_API_KEY not configured. Audio bridge idle.');
      return;
    }

    const url = `wss://api.openai.com/v1/realtime?model=${config.openai.realtimeModel}`;
    console.log(`[Voice Session] Connecting to OpenAI Realtime: ${url}`);

    this.session.openAiWs = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`
      }
    });

    this.session.openAiWs.on('open', () => {
      console.log(`[OpenAI Realtime] Connected successfully.`);
      this.configureSession();
    });

    this.session.openAiWs.on('message', (raw: any) => {
      this.handleOpenAiMessage(raw);
    });

    this.session.openAiWs.on('error', (err: any) => {
      console.error('[OpenAI Realtime] WebSocket Error:', err?.message || err);
    });

    this.session.openAiWs.on('close', (code: any, reason: any) => {
      console.log(`[OpenAI Realtime] Connection closed (${code}): ${reason?.toString() || ''}`);
    });
  }

  private configureSession() {
    if (!this.session.openAiWs || this.session.openAiWs.readyState !== WebSocket.OPEN) return;

    // Check customer info in DB to provide personalization
    let customerContext = '';
    const contact = dbService.getContactByPhone(this.session.callerPhone);
    if (contact && contact.name) {
      customerContext = ` The caller's name is ${contact.name}. Relevant notes: ${contact.notes || 'None'}.`;
    }

    const knowledgeContext = knowledgeService.getFormattedKnowledgeContext();

    const sessionUpdate = {
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: `${config.openai.systemPrompt}${customerContext}${knowledgeContext}\nYou are speaking to phone number: ${this.session.callerPhone}.`,
        audio: {
          input: {
            format: { type: 'audio/pcmu' },
            transcription: { model: 'whisper-1' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
              create_response: true,
              interrupt_response: true
            }
          },
          output: {
            format: { type: 'audio/pcmu' },
            voice: config.openai.voice
          }
        },
        tools: voiceTools,
        tool_choice: 'auto',
        temperature: config.openai.temperature
      }
    };

    this.session.openAiWs.send(JSON.stringify(sessionUpdate));

    // Trigger AI initial greeting
    setTimeout(() => {
      if (this.session.openAiWs && this.session.openAiWs.readyState === WebSocket.OPEN) {
        const initialGreeting = {
          type: 'response.create',
          response: {
            instructions: this.session.direction === 'inbound'
              ? 'Greet the caller warmly in a natural, polite tone, introduce yourself as Aura from Aura Smiles Dental Clinic, and ask how you can assist them with their dental care today. If the caller speaks Hindi, Gujarati, or English, fluently match their language.'
              : 'Warmly greet the recipient, say: "Hello, this is Aura calling from Aura Smiles Dental Clinic regarding your dental consultation inquiry. How can I assist you with your dental care today?" If the caller speaks Hindi or Gujarati, converse fluently in their language.'
          }
        };
        this.session.openAiWs.send(JSON.stringify(initialGreeting));
      }
    }, 500);
  }

  private async handleOpenAiMessage(raw: WebSocket.RawData) {
    try {
      const event = JSON.parse(raw.toString());

      switch (event.type) {
        // 1. Streaming audio chunks back to Twilio (Supports GA and legacy event names)
        case 'response.output_audio.delta':
        case 'response.audio.delta': {
          const delta = event.delta;
          if (delta && this.session.twilioWs.readyState === WebSocket.OPEN) {
            const mediaMessage = {
              event: 'media',
              streamSid: this.session.streamSid,
              media: {
                payload: delta
              }
            };
            this.session.twilioWs.send(JSON.stringify(mediaMessage));
          }
          break;
        }

        // 2. Interruption detection (Barge-in)
        case 'input_audio_buffer.speech_started': {
          console.log('[Voice Session] Interruption detected. Flushing Twilio audio buffer...');
          if (this.session.twilioWs.readyState === WebSocket.OPEN) {
            const clearMessage = {
              event: 'clear',
              streamSid: this.session.streamSid
            };
            this.session.twilioWs.send(JSON.stringify(clearMessage));
          }
          break;
        }

        // 3. Transcription of User speech
        case 'conversation.item.input_audio_transcription.completed': {
          if (event.transcript && event.transcript.trim()) {
            console.log(`[Caller (${this.session.callerPhone})]: ${event.transcript}`);
            this.session.transcriptEntries.push({
              speaker: 'user',
              text: event.transcript.trim(),
              time: new Date().toLocaleTimeString()
            });
            this.persistLiveTranscript();
          }
          break;
        }

        // 4. Transcription of Assistant speech (Supports GA and legacy event names)
        case 'response.output_audio_transcript.done':
        case 'response.audio_transcript.done': {
          if (event.transcript && event.transcript.trim()) {
            console.log(`[Aura AI]: ${event.transcript}`);
            this.session.transcriptEntries.push({
              speaker: 'assistant',
              text: event.transcript.trim(),
              time: new Date().toLocaleTimeString()
            });
            this.persistLiveTranscript();
          }
          break;
        }

        // 5. Function Calling / Tools
        case 'response.function_call_arguments.done': {
          const callId = event.call_id;
          const name = event.name;
          const args = JSON.parse(event.arguments || '{}');

          console.log(`[OpenAI Realtime] Executing function: ${name}`, args);
          const result = await executeTool(name, args, {
            callSid: this.session.callSid,
            callerPhone: this.session.callerPhone
          });

          // Send function result back to OpenAI session
          if (this.session.openAiWs && this.session.openAiWs.readyState === WebSocket.OPEN) {
            const outputEvent = {
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify(result)
              }
            };
            this.session.openAiWs.send(JSON.stringify(outputEvent));

            // Request next model response based on tool result
            this.session.openAiWs.send(JSON.stringify({ type: 'response.create' }));
          }
          break;
        }

        case 'error': {
          console.error('[OpenAI Realtime] Error event received:', event.error);
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('[Voice Session] Error processing OpenAI message:', err);
    }
  }

  private persistLiveTranscript() {
    if (!this.session.callSid) return;
    const formattedTranscript = this.session.transcriptEntries
      .map((entry) => `[${entry.time}] ${entry.speaker.toUpperCase()}: ${entry.text}`)
      .join('\n');
    const durationSeconds = Math.round((Date.now() - this.session.startTime) / 1000);
    dbService.updateCallStatus(this.session.callSid, 'in-progress', durationSeconds);
    dbService.saveCallTranscriptAndSummary(
      this.session.callSid,
      formattedTranscript,
      'Live call in progress...',
      'positive'
    );
  }

  public async endSession() {
    if (this.session.openAiWs) {
      try {
        this.session.openAiWs.close();
      } catch (_) {}
      this.session.openAiWs = null;
    }

    const durationSeconds = Math.round((Date.now() - this.session.startTime) / 1000);
    const formattedTranscript = this.session.transcriptEntries
      .map((entry) => `[${entry.time}] ${entry.speaker.toUpperCase()}: ${entry.text}`)
      .join('\n');

    console.log(`[Voice Session] Call ended (${durationSeconds}s). Total entries: ${this.session.transcriptEntries.length}`);

    if (this.session.callSid) {
      try {
        const analysis = await summaryService.analyzeCall(formattedTranscript);
        dbService.updateCallStatus(this.session.callSid, 'completed', durationSeconds);
        dbService.saveCallTranscriptAndSummary(
          this.session.callSid,
          formattedTranscript || 'No speech recorded during this session.',
          analysis.summary,
          analysis.sentiment
        );
      } catch (err: any) {
        console.error('[Voice Session] Analysis fallback:', err?.message || err);
        dbService.updateCallStatus(this.session.callSid, 'completed', durationSeconds);
        dbService.saveCallTranscriptAndSummary(
          this.session.callSid,
          formattedTranscript || 'No speech recorded during this session.',
          'Call completed.',
          'neutral'
        );
      }
    }
  }
}
