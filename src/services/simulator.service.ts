import OpenAI from 'openai';
import { dbService } from '../db/database.js';
import { executeTool } from './tools.service.js';
import { knowledgeService } from './knowledge.service.js';
import { config } from '../config.js';

interface SimulatorMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

type SupportedLang = 'en' | 'gu' | 'hi' | 'mr';

function detectLanguage(text: string): SupportedLang {
  const lower = text.toLowerCase();

  // Gujarati script or Gujlish keywords
  if (/[\u0A80-\u0AFF]/.test(text) || /\b(kem cho|kemcho|mane|karvi|che|chhe|tamare|ketla|aabhar|joiye|tame|nathi|suchi|bhav|kal|khullu|pila|daant|tamari|tamaru|ketli)\b/.test(lower)) {
    return 'gu';
  }

  // Marathi specific markers
  if (/\b(namaskar|kase|aahat|karaycha|karaychi|pahije|kiti|udya|ahe|kashi)\b/.test(lower) || (/[\u0900-\u097F]/.test(text) && /\b(आहे|कसे|कशी|करा|पाहिजे|उद्या|किती)\b/.test(text))) {
    return 'mr';
  }

  // Hindi script or Hinglish
  if (/[\u0900-\u097F]/.test(text) || /\b(namaste|kaise|karna|chahiye|kitna|hoga|kripya|shukriya|dhanyawad|bataye|hai|karein|kab|khulta|khulata|khulega|aapka|humara)\b/.test(lower)) {
    return 'hi';
  }

  return 'en';
}

const SIMULATOR_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Book a dental appointment for a patient at Aura Smiles Dental Clinic',
      parameters: {
        type: 'object',
        properties: {
          customerName: { type: 'string', description: 'Patient full name' },
          service: { type: 'string', description: 'Dental service (e.g. Dental Consultation, Cleaning, Root Canal, Teeth Whitening)' },
          dateTime: { type: 'string', description: 'Requested appointment date and time (e.g. Tomorrow at 3:00 PM)' },
          notes: { type: 'string', description: 'Special symptoms or notes' }
        },
        required: ['dateTime']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Check available appointment slots for a given date',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date to check availability for (e.g. today, tomorrow, Saturday)' }
        },
        required: ['date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'identify_caller',
      description: 'Store or update the patient name and contact information',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Caller or patient name' }
        },
        required: ['name']
      }
    }
  }
];

export class LocalSimulatorService {
  private openai: OpenAI | null = null;

  constructor() {
    if (config.openai.apiKey) {
      this.openai = new OpenAI({ apiKey: config.openai.apiKey });
    }
  }

  /**
   * Processes a turn in simulation mode.
   * Leverages OpenAI gpt-4o-mini with verified dental clinic knowledge base and fallback.
   */
  public async processSimulatorTurn(
    callerPhone: string,
    callSid: string,
    userText: string,
    history: SimulatorMessage[]
  ): Promise<{ replyText: string; toolExecuted?: string; toolResult?: any; lang?: string }> {
    const lang = detectLanguage(userText);

    // Pull saved caller identity for natural human personalization
    const contact = dbService.getContactByPhone(callerPhone);
    const callerName = contact && contact.name ? contact.name : '';
    const salutationEn = callerName ? `${callerName}` : 'there';
    const salutationHi = callerName ? `${callerName} जी` : 'जी';
    const salutationGu = callerName ? `${callerName} ભાઈ` : 'ભાઈ/બહેન';

    // 1. PRIMARY ENGINE: Use OpenAI if API key is present
    if (config.openai.apiKey) {
      try {
        if (!this.openai) {
          this.openai = new OpenAI({ apiKey: config.openai.apiKey });
        }

        const knowledgeContext = knowledgeService.getFormattedKnowledgeContext();
        const systemPrompt = `You are "Aura", a warm, empathetic, and highly professional AI voice receptionist at Aura Smiles Dental Clinic.
${knowledgeContext}

KEY CLINIC FACTS:
- Address: 402 Crystal Heights, SG Highway, Ahmedabad (with free valet parking).
- Established / Age: Founded in 2011, serving patients with excellence for over 15 years.
- Operating Hours: Monday to Friday 8:00 AM to 8:00 PM; Saturday 9:00 AM to 5:00 PM; Sunday 10:00 AM to 2:00 PM for emergencies & appointments.
- 24/7 Emergency Helpline: +91 98765 43210.
- Key Doctors: Dr. Ananya Sharma (Orthodontist, 14 yrs exp), Dr. Rajesh Patel (Implants & Surgery, 16 yrs exp), Dr. Samir Mehta (Root Canal, Microscope RCT), Dr. Priya Nair (Pediatric Kids Dentist).
- Consultation & Digital X-Ray fee: ₹500 ($50).

MULTILINGUAL VOICE RULES:
- Fluently reply in the exact language the user speaks.
- If the user speaks Gujarati (ગુજરાતી), reply in natural, polite, conversational Gujarati! (e.g. "ઔરા સ્માઈલ્સ ડેન્ટલ ક્લિનિક 2011માં શરૂ થયું હતું, એટલે કે અમારી ક્લિનિકને 15 વર્ષથી વધુ સમય થયો છે...")
- If the user speaks Hindi, reply in natural conversational Hindi.
- If the user speaks English, reply in natural conversational English.
- Keep responses short, concise, and conversational (1 to 2 sentences per turn is ideal for voice calls).
- Do not use markdown symbols (*, #, bullet points) in your replies.
- When the user asks to book an appointment, check availability, or gives their name, invoke the relevant tool.`;

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
          { role: 'system', content: systemPrompt }
        ];

        // Append conversation history (up to last 6 turns)
        for (const msg of (history || []).slice(-6)) {
          if (msg.role === 'user' || msg.role === 'assistant') {
            messages.push({ role: msg.role, content: msg.content });
          }
        }

        messages.push({ role: 'user', content: userText });

        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages,
          tools: SIMULATOR_TOOLS,
          tool_choice: 'auto',
          temperature: 0.6
        });

        const choice = response.choices[0];
        const message = choice.message;

        // Check if OpenAI decided to execute a tool (e.g. book appointment)
        if (message.tool_calls && message.tool_calls.length > 0) {
          const toolCall = message.tool_calls[0];
          if (toolCall.type === 'function') {
            const fnName = toolCall.function.name;
            const fnArgs = JSON.parse(toolCall.function.arguments || '{}');

            const toolResult = await executeTool(fnName, fnArgs, { callSid, callerPhone });

            // Feed tool result back to model to get final spoken confirmation
            messages.push(message);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResult)
            });

            const followUp = await this.openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages,
              temperature: 0.6
            });

            const replyText = followUp.choices[0].message.content || 'Your request has been processed successfully.';
            return {
              replyText: replyText.replace(/[*#]/g, '').trim(),
              toolExecuted: fnName,
              toolResult,
              lang
            };
          }
        }

        if (message.content) {
          return {
            replyText: message.content.replace(/[*#]/g, '').trim(),
            lang
          };
        }
      } catch (err: any) {
        console.error('[Simulator Engine] OpenAI error, engaging rule-based fallback:', err.message);
      }
    }

    // 2. SECONDARY FALLBACK: Rule-based engine
    let lower = userText.toLowerCase().trim();

    // Opening Hours / Timings
    if (lower.includes('timing') || lower.includes('open') || lower.includes('close') || lower.includes('closing') || lower.includes('khul') || lower.includes('samay') || lower.includes('સમય') || lower.includes('સમયગાળો') || lower.includes('ક્યારે ખુલે')) {
      let reply = `Our clinic is open Monday to Friday from 8:00 AM to 8:00 PM continuously, Saturday from 9:00 AM to 5:00 PM, and Sunday from 10:00 AM to 2:00 PM for appointments and emergencies.`;
      if (lang === 'gu') reply = `ઔરા સ્માઈલ્સ ડેન્ટલ ક્લિનિક સોમવાર થી શુક્રવાર સવારે 8:00 થી રાત્રે 8:00 વાગ્યા સુધી, શનિવારે સવારે 9:00 થી સાંજે 5:00, અને રવિવારે સવારે 10:00 થી બપોરે 2:00 વાગ્યા સુધી ખુલ્લું રહે છે.`;
      else if (lang === 'hi') reply = `हमारा क्लिनिक सोमवार से शुक्रवार सुबह 8:00 बजे से रात 8:00 बजे तक, शनिवार को 9:00 से 5:00 बजे तक, और रविवार को 10:00 से 2:00 बजे तक खुला रहता है।`;
      return { replyText: reply, lang };
    }

    // Address / Location
    if (lower.includes('address') || lower.includes('location') || lower.includes('where') || lower.includes('kahan') || lower.includes('ક્યાં') || lower.includes('સરનામું') || lower.includes('એડ્રેસ')) {
      let reply = `Our clinic address is 402 Crystal Heights, SG Highway, Ahmedabad, with free valet parking.`;
      if (lang === 'gu') reply = `અમારું સરનામું છે: 402 ક્રિસ્ટલ હાઇટ્સ, એસજી હાઈવે, અમદાવાદ (વિનામૂલ્યે વેલે પાર્કિંગ ઉપલબ્ધ છે).`;
      else if (lang === 'hi') reply = `हमारा पता है: 402 क्रिस्टल हाइट्स, एसजी हाईवे, अहमदाबाद।`;
      return { replyText: reply, lang };
    }

    // Age of clinic / Establishment
    if (lower.includes('old') || lower.includes('kitni purani') || lower.includes('ketli juni') || lower.includes('ketla varsh') || lower.includes('સ્થાપના') || lower.includes('કેટલી જૂની')) {
      let reply = `Aura Smiles Dental Clinic was established in 2011 and has been proudly serving patients with excellence for over 15 years.`;
      if (lang === 'gu') reply = `ઔરા સ્માઈલ્સ ડેન્ટલ ક્લિનિકની સ્થાપના 2011માં થઈ હતી, એટલે કે અમે છેલ્લા 15 વર્ષથી દર્દીઓની નિષ્ઠાપૂર્વક સેવા કરી રહ્યા છીએ.`;
      else if (lang === 'hi') reply = `ऑरा स्माइल्स डेंटल क्लिनिक की स्थापना 2011 में हुई थी, और हम 15 से अधिक वर्षों से उत्कृष्टता के साथ सेवा कर रहे हैं।`;
      return { replyText: reply, lang };
    }

    // Pricing / Charges
    if (lower.includes('price') || lower.includes('fee') || lower.includes('cost') || lower.includes('kitna') || lower.includes('ketla') || lower.includes('ભાવ') || lower.includes('ખર્ચ')) {
      let reply = `Our comprehensive consultation and digital X-ray is ₹500. Teeth cleaning is ₹1,200, root canal is ₹4,500, and zirconia crowns are ₹8,500.`;
      if (lang === 'gu') reply = `કન્સલ્ટેશન અને ડિજિટલ એક્સ-રેની ફી ₹500 છે. દાંતની સફાઈ ₹1,200, રૂટ કેનાલ ₹4,500, અને ઝિર્કોનિયા કેપ ₹8,500 છે.`;
      else if (lang === 'hi') reply = `परामर्श और डिजिटल एक्स-रे की फीस ₹500 है। दांतों की सफाई ₹1,200, रूट कैनाल ₹4,500, और कैप ₹8,500 है।`;
      return { replyText: reply, lang };
    }

    // Default polite response
    let replyText = `I understand, ${salutationEn}! I can assist you with booking an appointment, clinic timings, treatment costs, or doctor details. How can I help you today?`;
    if (lang === 'gu') replyText = `હું સમજી શકું છું, ${salutationGu}! હું અપોઇન્ટમેન્ટ બુકિંગ, ક્લિનિકનો સમય, સારવારનો ખર્ચ અથવા ડૉક્ટરની વિગતોમાં તમારી મદદ કરી શકું છું. તમારે શું માહિતી જોઈએ છે?`;
    else if (lang === 'hi') replyText = `मैं समझ सकती हूँ, ${salutationHi}! मैं अपॉइंटमेंट, क्लिनिक का समय, फीस या डॉक्टरों की जानकारी में आपकी सहायता कर सकती हूँ। आप क्या जानना चाहते हैं?`;

    return { replyText, lang };
  }

  /**
   * Completes a simulated call, saves history to DB and returns summary
   */
  public finishSimulatedCall(callSid: string, callerPhone: string, transcript: string, durationSeconds: number) {
    let sentiment = 'positive';
    const lower = transcript.toLowerCase();
    if (lower.includes('bad') || lower.includes('angry') || lower.includes('frustrated') || lower.includes('terrible')) {
      sentiment = 'negative';
    } else if (lower.includes('human') || lower.includes('transfer')) {
      sentiment = 'escalated';
    }

    const summary = `Local Simulated Call with ${callerPhone}. Call duration: ${durationSeconds} seconds. The user interacted with the AI voice concierge and tested appointment scheduling, multi-language inquiries, and conversational tools.`;

    dbService.createCall({
      call_sid: callSid,
      direction: 'inbound',
      from_number: callerPhone,
      to_number: 'LOCAL-SIMULATOR',
      status: 'completed'
    });

    dbService.updateCallStatus(callSid, 'completed', durationSeconds);
    dbService.saveCallTranscriptAndSummary(callSid, transcript, summary, sentiment);

    return {
      callSid,
      summary,
      sentiment,
      duration: durationSeconds
    };
  }
}

export const localSimulatorService = new LocalSimulatorService();
