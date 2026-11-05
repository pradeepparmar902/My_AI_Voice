import { dbService } from '../db/database.js';
import { executeTool } from './tools.service.js';
import { knowledgeService } from './knowledge.service.js';

interface SimulatorMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

type SupportedLang = 'en' | 'gu' | 'hi' | 'mr';

function detectLanguage(text: string): SupportedLang {
  const lower = text.toLowerCase();

  // Gujarati script or Gujlish
  if (/[\u0A80-\u0AFF]/.test(text) || /\b(kem cho|kemcho|mane|karvi|che|tamare|ketla|aabhar|joiye|tame|nathi)\b/.test(lower)) {
    return 'gu';
  }

  // Marathi specific markers
  if (/\b(namaskar|kase|aahat|karaycha|karaychi|pahije|kiti|udya|ahe|kashi)\b/.test(lower) || /[\u0900-\u097F]/.test(text) && /\b(आहे|कसे|कशी|करा|पाहिजे|उद्या|किती)\b/.test(text)) {
    return 'mr';
  }

  // Hindi script or Hinglish
  if (/[\u0900-\u097F]/.test(text) || /\b(namaste|kaise|karna|chahiye|kitna|hoga|kripya|shukriya|dhanyawad|bataye|hai|karein)\b/.test(lower)) {
    return 'hi';
  }

  return 'en';
}

export class LocalSimulatorService {
  /**
   * Processes a turn in local simulation mode without requiring OpenAI API key.
   * Understands appointment booking, availability checks, customer lookups, and transfers.
   */
  public async processSimulatorTurn(
    callerPhone: string,
    callSid: string,
    userText: string,
    history: SimulatorMessage[]
  ): Promise<{ replyText: string; toolExecuted?: string; toolResult?: any; lang?: string }> {
    const lower = userText.toLowerCase().trim();
    const lang = detectLanguage(userText);

    // 1. Detect Appointment Booking intent (Multi-language)
    const isBooking = lower.includes('book') || lower.includes('appointment') || lower.includes('schedule') || 
      lower.includes('reserve') || lower.includes('અપોઇન્ટમેન્ટ') || lower.includes('બુક') || lower.includes('अपॉइंटमेंट') ||
      lower.includes('बुक') || lower.includes('हवी आहे') || lower.includes('करायचे');

    if (isBooking) {
      let service = 'General Consultation';
      if (lower.includes('dental') || lower.includes('teeth') || lower.includes('દાંત') || lower.includes('दांत')) service = 'Dental Consultation';
      else if (lower.includes('cleaning') || lower.includes('ક્લીનિંગ') || lower.includes('सफाई')) service = 'Dental Cleaning';
      else if (lower.includes('demo') || lower.includes('sales')) service = 'Product Demo';

      let dateTime = 'Tomorrow at 3:00 PM';
      if (lower.includes('today') || lower.includes('આજે') || lower.includes('आज')) dateTime = 'Today at 4:30 PM';
      else if (lower.includes('morning') || lower.includes('સવારે') || lower.includes('सुबह') || lower.includes('सकाळी')) dateTime = 'Tomorrow at 10:00 AM';

      const toolResult = await executeTool(
        'book_appointment',
        {
          customer_name: 'Local Test User',
          service,
          date_time: dateTime,
          notes: `Booked via Local Simulator (${lang}): "${userText}"`
        },
        { callSid, callerPhone }
      );

      let replyText = `I have scheduled your ${service} for ${dateTime}. You will receive a confirmation shortly! Is there anything else I can assist you with?`;
      if (lang === 'gu') {
        replyText = `તમારી ${service} માટે અપોઇન્ટમેન્ટ ${dateTime} ના સમય માટે બુક કરી લીધી છે. તમને કન્ફર્મેશન મેસેજ મળશે. શું હું તમને અન્ય કોઈ મદદ કરી શકું?`;
      } else if (lang === 'hi') {
        replyText = `आपकी ${service} के लिए अपॉइंटमेंट ${dateTime} पर सफलतापूर्वक बुक हो गई है। इसका कन्फर्मेशन आपको मिल जाएगा। क्या मैं आपकी और कोई सहायता करूँ?`;
      } else if (lang === 'mr') {
        replyText = `तुमची ${service} ची अपॉइंटमेंट ${dateTime} साठी बुक झाली आहे. तुम्हाला मेसेज येईल. अजून काही मदत हवी आहे का?`;
      }

      return { replyText, toolExecuted: 'book_appointment', toolResult, lang };
    }

    // 2. Detect Availability check (only when asking for open slots or appointment openings)
    const isAvail = (lower.includes('slots') || lower.includes('slot') || lower.includes('available slots') || 
      lower.includes('openings') || lower.includes('when can i come') || lower.includes('ક્યારે આવી શકું') || 
      lower.includes('સ્લોટ') || lower.includes('स्लॉट') || (lower.includes('available') && !lower.includes('time')));

    if (isAvail) {
      const toolResult = await executeTool('check_availability', { date: 'tomorrow' }, { callSid, callerPhone });
      let replyText = 'For tomorrow, we currently have openings at 10:00 AM, 1:30 PM, 3:00 PM, and 4:30 PM. Which of those works best for you?';
      if (lang === 'gu') {
        replyText = 'કાલ માટે 10:00 AM, 1:30 PM, 3:00 PM અને 4:30 PM ના સ્લોટ્સ ખાલી છે. તમને કયો સમય યોગ્ય રહેશે?';
      } else if (lang === 'hi') {
        replyText = 'कल के लिए 10:00 AM, 1:30 PM, 3:00 PM और 4:30 PM के स्लॉट खाली हैं। आपके लिए कौन सा समय सही रहेगा?';
      } else if (lang === 'mr') {
        replyText = 'उद्यासाठी 10:00 AM, 1:30 PM, 3:00 PM आणि 4:30 PM चे स्लॉट्स उपलब्ध आहेत. कोणता वेळ सोयीचा वाटेल?';
      }
      return { replyText, toolExecuted: 'check_availability', toolResult, lang };
    }

    // 3. Detect Call Transfer intent (Multi-language)
    const isTransfer = lower.includes('human') || lower.includes('operator') || lower.includes('supervisor') || 
      lower.includes('agent') || lower.includes('representative') || lower.includes('માણસ') || lower.includes('इंसान') || lower.includes('व्यक्ती');

    if (isTransfer) {
      let replyText = 'I completely understand. Please hold for just a moment while I transfer you directly to our human specialist.';
      if (lang === 'gu') {
        replyText = 'ચોક્કસ, કૃપા કરીને થોડી ક્ષણ રાહ જુઓ, હું તમારો કૉલ અમારા એજન્ટને ટ્રાન્સફર કરી રહી છું.';
      } else if (lang === 'hi') {
        replyText = 'जी बिल्कुल, कृपया एक क्षण प्रतीक्षा करें, मैं आपका कॉल हमारे प्रतिनिधि को ट्रांसफर कर रही हूँ।';
      } else if (lang === 'mr') {
        replyText = 'नक्कीच, कृपया एक क्षण थांबा, मी आपला कॉल आमच्या प्रतिनिधीकडे वर्ग करत आहे.';
      }
      return { replyText, toolExecuted: 'transfer_call_to_human', toolResult: { success: true }, lang };
    }

    // 4. Detect Customer Lookup
    if (lower.includes('who am i') || lower.includes('lookup') || lower.includes('my details') || lower.includes('profile')) {
      const toolResult = await executeTool('lookup_customer', { phone: callerPhone }, { callSid, callerPhone });
      if (toolResult.found) {
        return {
          replyText: `I found your file! You are registered as ${toolResult.name}, with notes: ${toolResult.notes || 'None'}. How can I help you today?`,
          toolExecuted: 'lookup_customer',
          toolResult,
          lang
        };
      }
      return {
        replyText: `You are connected from ${callerPhone}. I see you are a new customer. How can I assist you today?`,
        toolExecuted: 'lookup_customer',
        toolResult,
        lang
      };
    }

    // 5. Query Knowledge Base for Company Information, FAQs, Pricing, Hours, Policies
    const matchedDocs = knowledgeService.searchKnowledge(userText);
    if (matchedDocs.length > 0) {
      const doc = matchedDocs[0];
      const lines = doc.content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

      // Score each line in the document to extract the most relevant fact
      const queryWords = lower.replace(/[^\w\s\u0A80-\u0AFF\u0900-\u097F]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
      let bestLine = lines[0];
      let maxScore = -1;

      for (const line of lines) {
        const lineLower = line.toLowerCase();
        let score = 0;
        for (const w of queryWords) {
          const stem = w.length > 4 ? w.substring(0, 4) : w;
          if (lineLower.includes(w)) score += 3;
          else if (lineLower.includes(stem)) score += 1;
        }
        if (score > maxScore) {
          maxScore = score;
          bestLine = line;
        }
      }

      let replyText = `According to our ${doc.title}: ${bestLine}. Would you like any further details or help scheduling an appointment?`;
      if (lang === 'gu') {
        replyText = `અમારા ${doc.title} મુજબ: ${bestLine}. શું તમને વધુ માહિતી અથવા અપોઇન્ટમેન્ટ બુકિંગમાં મદદ જોઈએ છે?`;
      } else if (lang === 'hi') {
        replyText = `हमारे ${doc.title} के अनुसार: ${bestLine}। क्या आपको कोई और जानकारी चाहिए या अपॉइंटमेंट बुक करना है?`;
      } else if (lang === 'mr') {
        replyText = `आमच्या ${doc.title} नुसार: ${bestLine}. अजून काही माहिती हवी आहे का किंवा अपॉइंटमेंट हवी आहे का?`;
      }

      return {
        replyText,
        toolExecuted: 'query_knowledge_base',
        toolResult: { document: doc.title, snippet: bestLine },
        lang
      };
    }

    // 6. Greeting intents (Multi-language)
    const isGreeting = lower.includes('hello') || lower.includes('hi') || lower.includes('hey') || 
      lower.includes('નમસ્તે') || lower.includes('કેમ છો') || lower.includes('kem cho') ||
      lower.includes('नमस्ते') || lower.includes('नमस्कार') || lower.includes('namaste') || lower.length === 0;

    if (isGreeting) {
      let replyText = "Hello! This is Aura, your AI voice assistant. I can help you schedule appointments, look up your account, or answer your questions. What can I do for you today?";
      if (lang === 'gu') {
        replyText = "નમસ્તે! હું ઓરા છું, તમારી AI વોઇસ આસિસ્ટન્ટ. હું તમને અપોઇન્ટમેન્ટ બુકિંગ અથવા માહિતીમાં મદદ કરી શકું છું. હું તમારી શું સેવા કરું?";
      } else if (lang === 'hi') {
        replyText = "नमस्ते! मैं ऑरा हूँ, आपकी AI वॉइस असिस्टेंट। मैं आपकी अपॉइंटमेंट बुक करने और जानकारी देने में मदद कर सकती हूँ। बताइए, आज मैं आपकी क्या सहायता करूँ?";
      } else if (lang === 'mr') {
        replyText = "नमस्कार! मी ऑरा, तुमची AI व्हॉइस असिस्टंट. मी तुम्हाला अपॉइंटमेंट बुक करण्यासाठी किंवा माहिती देण्यासाठी मदत करू शकते. सांगा, मी कशी मदत करू?";
      }
      return { replyText, lang };
    }

    // 7. Goodbyes / End Call
    if (lower.includes('bye') || lower.includes('thank you') || lower.includes('thanks') || lower.includes('goodbye') || lower.includes('આભાર') || lower.includes('धन्यवाद') || lower.includes('शुक्रिया')) {
      let replyText = "You are very welcome! Thank you for calling. Have a wonderful rest of your day!";
      if (lang === 'gu') replyText = "ખૂબ ખૂબ આભાર! કૉલ કરવા બદલ ધન્યવાદ. તમારો દિવસ શુભ રહે!";
      else if (lang === 'hi') replyText = "आपका बहुत-बहुत धन्यवाद! कॉल करने के लिए शुक्रिया। आपका दिन शुभ हो!";
      else if (lang === 'mr') replyText = "खूप खूप धन्यवाद! आपला दिवस चांगला जावो!";
      return { replyText, lang };
    }

    // Default intelligent conversational fallback
    let replyText = `I understand you mentioned: "${userText}". I can help book a consultation, check available dates, or connect you to an agent. Would you like to schedule a slot?`;
    if (lang === 'gu') {
      replyText = `હું સમજી શકું છું. હું અપોઇન્ટમેન્ટ બુકિંગ અથવા માહિતીમાં તમારી મદદ કરી શકું છું. શું તમારે સ્લોટ બુક કરવો છે?`;
    } else if (lang === 'hi') {
      replyText = `मैं समझ सकती हूँ। मैं अपॉइंटमेंट बुक करने या जानकारी देने में आपकी मदद कर सकती हूँ। क्या आप स्लॉट बुक करना चाहते हैं?`;
    } else if (lang === 'mr') {
      replyText = `मी समजू शकते. मी अपॉइंटमेंट बुक करण्यासाठी किंवा माहिती देण्यासाठी मदत करू शकते. तुम्हाला स्लॉट बुक करायचा आहे का?`;
    }

    return {
      replyText,
      lang
    };
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

    const summary = `Local Simulated Call with ${callerPhone}. Call duration: ${durationSeconds} seconds. The user interacted with the AI voice concierge and tested appointment scheduling and conversational tools.`;

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
