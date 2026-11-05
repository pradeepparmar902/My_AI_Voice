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

  // Gujarati script or Gujlish keywords
  if (/[\u0A80-\u0AFF]/.test(text) || /\b(kem cho|kemcho|mane|karvi|che|chhe|tamare|ketla|aabhar|joiye|tame|nathi|suchi|bhav|kal|khullu|pila|daant)\b/.test(lower)) {
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

export class LocalSimulatorService {
  /**
   * Processes a turn in local simulation mode without requiring OpenAI API key.
   * Understands clinic timings, treatments, pricing lists, doctor team, toothache triage, bookings, and regional languages.
   */
  public async processSimulatorTurn(
    callerPhone: string,
    callSid: string,
    userText: string,
    history: SimulatorMessage[]
  ): Promise<{ replyText: string; toolExecuted?: string; toolResult?: any; lang?: string }> {
    let lower = userText.toLowerCase().trim();
    const lang = detectLanguage(userText);

    // Pull saved caller identity for natural human personalization
    const contact = dbService.getContactByPhone(callerPhone);
    const callerName = contact && contact.name ? contact.name : '';
    const salutationEn = callerName ? `${callerName}` : 'there';
    const salutationHi = callerName ? `${callerName} जी` : 'जी';
    const salutationGu = callerName ? `${callerName} ભાઈ` : 'ભાઈ/બહેન';

    // Normalize common speech-to-text phonetic misrecognitions
    if (lower.includes('truth or yellow') || lower.includes('truth yellow') || lower.includes('tooth egg') || lower.includes('tooth ace')) {
      if (lower.includes('yellow')) lower = 'teeth yellow whitening';
      else lower = 'toothache';
    }

    // 1. User Name Introduction ("my name is ...", "I am ...")
    const nameMatch = userText.match(/(?:my name is|i am|this is|call me)\s+([A-Za-z\u0A80-\u0AFF\u0900-\u097F\s]{2,25})/i);
    if (nameMatch && !lower.includes('book') && !lower.includes('appointment')) {
      const extractedName = nameMatch[1].trim().replace(/(please|here|calling).*$/i, '').trim();
      dbService.upsertContact(callerPhone, extractedName, 'Identified via Voice Call');

      let reply = `It's a pleasure to speak with you, ${extractedName}! Welcome to Aura Smiles Dental Clinic. How are your teeth feeling today, or what can I assist you with?`;
      if (lang === 'gu') reply = `નમસ્તે ${extractedName} ભાઈ! ઔરા સ્માઈલ્સ ડેન્ટલ ક્લિનિકમાં આપનું હાર્દિક સ્વાગત છે. હું તમારી દાંતની સારવાર અથવા માહિતીમાં કેવી રીતે મદદ કરી શકું?`;
      else if (lang === 'hi') reply = `नमस्ते ${extractedName} जी! ऑरा स्माइल्स डेंटल में आपका स्वागत है। बताइए, मैं आपके दांतों की देखभाल या जानकारी में क्या सहायता करूँ?`;
      else if (lang === 'mr') reply = `नमस्कार ${extractedName} जी! ऑरा स्माइल्स डेंटल क्लिनिकमध्ये आपले स्वागत आहे. सांगा, मी कशी मदत करू?`;

      return { replyText: reply, toolExecuted: 'identify_caller', toolResult: { name: extractedName }, lang };
    }

    // 2. Greetings & Well-being ("hi how are you", "hello", "kem cho", "kaise ho")
    if (lower.includes('how are you') || lower.includes('how r u') || lower.includes('kem cho') || lower.includes('kaise ho') || lower.includes('kase aahat')) {
      let reply = `I am doing great, ${salutationEn}! Thank you so much for asking. How are you doing today, and how can I help you with your dental care?`;
      if (lang === 'gu') reply = `હું એકદમ મજામાં છું, ${salutationGu}! પૂછવા બદલ ખૂબ ખૂબ આભાર. આપ કેમ છો અને આજે હું તમારી દાંતની સારવારમાં શું સેવા કરું?`;
      else if (lang === 'hi') reply = `मैं बिल्कुल ठीक हूँ, ${salutationHi}! पूछने के लिए बहुत-बहुत धन्यवाद। आप कैसे हैं और आज मैं आपके लिए क्या कर सकती हूँ?`;
      else if (lang === 'mr') reply = `मी मजेत आहे, ${salutationEn}! विचारल्याबद्दल धन्यवाद. मी आपली काय मदत करू शकते?`;

      return { replyText: reply, toolExecuted: 'greeting', lang };
    }

    if (lower === 'hi' || lower === 'hello' || lower === 'hey' || lower === 'hi hi' || lower.startsWith('hi ') || lower.startsWith('hello ') || lower.startsWith('hey ')) {
      let reply = `Hello ${salutationEn}! It's great to hear from you. Welcome to Aura Smiles Dental Clinic. What can I help you with today?`;
      if (lang === 'gu') reply = `નમસ્તે ${salutationGu}! ઔરા સ્માઈલ્સ ડેન્ટલ ક્લિનિકમાં આપનું હાર્દિક સ્વાગત છે. હું તમારી શું સેવા કરી શકું?`;
      else if (lang === 'hi') reply = `नमस्ते ${salutationHi}! ऑरा स्माइल्स डेंटल में आपका स्वागत है। बताइए, आज मैं आपकी क्या सहायता करूँ?`;

      return { replyText: reply, toolExecuted: 'greeting', lang };
    }

    // 2. Yellow Teeth / Cosmetic Whitening inquiry ("my teeth are yellow", "teeth whitening", "truth or yellow", "yellow")
    if (lower.includes('yellow') || lower.includes('whiten') || lower.includes('stain') || lower.includes('pila') || lower.includes('peela') || lower.includes('પીળા') || lower.includes('પીળાશ')) {
      let reply = `I completely understand, ${salutationEn}! Yellowing or staining is very common from daily tea, coffee, or food. At Aura Smiles, we have an advanced In-Office Laser Whitening session (₹7,500) that safely lightens teeth by 6 to 8 shades in just one hour, as well as take-home kits for ₹4,500. We can also schedule a ₹500 consultation to check your enamel. Would you like to book a slot?`;
      if (lang === 'gu') reply = `હું સમજી શકું છું, ${salutationGu}! ચા, કૉફી કે ખોરાકથી દાંત પીળા થવા એ ખૂબ સામાન્ય છે. ઔરા સ્માઈલ્સમાં અમારી પાસે ₹7,500 માં 1-કલાકનું લેસર વ્હાઇટનિંગ છે જેથી દાંત એકદમ સફેદ ચમકદાર થઈ જાય છે. શું હું તમારા માટે તપાસનો સ્લોટ બુક કરું?`;
      else if (lang === 'hi') reply = `मैं समझ सकती हूँ, ${salutationHi}! चाय, कॉफी या भोजन से दांतों में पीलापन आना बहुत सामान्य है। ऑरा स्माइल्स में हमारे पास ₹7,500 में 1-घंटे की लेजर टीथ वाइटनिंग सुविधा है जिससे दांत 6 से 8 शेड चमकदार हो जाते हैं। क्या आप इसके लिए अपॉइंटमेंट लेना चाहेंगे?`;

      return { replyText: reply, toolExecuted: 'whitening_advice', lang };
    }

    // 3. Toothache / Dental Pain / Symptoms ("I have a toothache", "pain in teeth")
    if (lower.includes('toothache') || lower.includes('pain') || lower.includes('swelling') || lower.includes('bleeding') || lower.includes('sensitivity') || lower.includes('દાંતમાં દુખાવો') || lower.includes('दांत में दर्द') || lower.includes('दाढ दुखी')) {
      let reply = `I'm really sorry to hear you're in discomfort, ${salutationEn}! For toothache, we strongly recommend coming in for a ₹500 digital X-ray and checkup with Dr. Samir (our root canal expert) or Dr. Rajesh to identify if it's a cavity, nerve inflammation, or gum issue. Would you like me to reserve a priority consultation for you today?`;
      if (lang === 'gu') reply = `દાંતમાં દુખાવા માટે ખેદ છે, ${salutationGu}. અમારા નિષ્ણાત ડૉક્ટર પાસે ₹500 માં ડિજિટલ એક્સ-રે અને તપાસ કરાવી લેવી જોઈએ જેથી યોગ્ય સારવાર થઈ શકે. શું હું તમારા માટે આજનો સ્લોટ બુક કરું?`;
      else if (lang === 'hi') reply = `दांत के दर्द के लिए खेद है, ${salutationHi}। हम आपको ₹500 में डिजिटल एक्स-रे और डॉक्टर से जांच कराने की सलाह देते हैं ताकि सही इलाज हो सके। क्या मैं आपके लिए आज का समय बुक करूँ?`;

      return { replyText: reply, toolExecuted: 'triage_symptom', toolResult: { symptom: 'toothache' }, lang };
    }

    // 4. Hindi / Gujarati Specific Opening Hours ("aapka clinic kab khulata hai", "kya re khule che", "timing su che")
    if (lower.includes('kab khul') || lower.includes('kab open') || lower.includes('khulata hai') || lower.includes('khulta hai') || lower.includes('khulega') || lower.includes('kya re khule') || lower.includes('khulvano samay') || lower.includes('samay su')) {
      let reply = `Our clinic opens Monday to Friday from 8:00 AM to 8:00 PM continuously, Saturday from 9:00 AM to 5:00 PM, and Sunday from 10:00 AM to 2:00 PM. Emergency care is available 24/7. Which day would you like to visit?`;
      if (lang === 'gu') reply = `હા ${salutationGu}, અમારું ક્લિનિક સોમવાર થી શુક્રવાર સવારે 8:00 વાગ્યે ખુલે છે (અને રાત્રે 8:00 સુધી ચાલુ રહે છે), શનિવારે સવારે 9:00 થી 5:00, અને રવિવારે સવારે 10:00 થી બપોરે 2:00 વાગ્યા સુધી ખુલ્લું રહે છે. તમે ક્યારે પધારવા માંગો છો?`;
      else if (lang === 'hi') reply = `जी ${salutationHi}, हमारा क्लिनिक सोमवार से शुक्रवार सुबह 8:00 बजे खुलता है (और रात 8:00 बजे तक चालू रहता है), शनिवार को सुबह 9:00 से शाम 5:00 बजे तक, और रविवार को सुबह 10:00 से दोपहर 2:00 बजे तक खुला रहता है। आप किस दिन आना पसंद करेंगे?`;

      return { replyText: reply, toolExecuted: 'query_opening_hours', lang };
    }

    // 5. Specific Day Timing: Sunday
    if (lower.includes('sunday') || lower.includes('રવિવાર') || lower.includes('रविवार')) {
      let reply = `Yes ${salutationEn}! On Sundays, our clinic is open from 10:00 AM to 2:00 PM for specialist consultations and emergency treatments. Plus our 24/7 emergency line is always on-call.`;
      if (lang === 'gu') reply = `હા ${salutationGu}! રવિવારે અમારું ક્લિનિક સવારે 10:00 થી બપોરે 2:00 વાગ્યા સુધી ખુલ્લું રહે છે અને ઈમરજન્સી સેવા 24 કલાક ઉપલબ્ધ છે.`;
      else if (lang === 'hi') reply = `जी ${salutationHi}! रविवार को हमारा क्लिनिक सुबह 10:00 बजे से दोपहर 2:00 बजे तक खुला रहता है और आपातकालीन सेवा 24 घंटे उपलब्ध है।`;

      return { replyText: reply, toolExecuted: 'query_sunday_hours', lang };
    }

    // 6. Specific Day Timing: Saturday
    if (lower.includes('saturday') || lower.includes('શનિવાર') || lower.includes('शनिवार')) {
      let reply = `On Saturdays, we are open from 9:00 AM to 5:00 PM. Would you like to reserve a consultation slot for Saturday?`;
      if (lang === 'gu') reply = `શનિવારે અમારું ક્લિનિક સવારે 9:00 થી સાંજે 5:00 વાગ્યા સુધી ખુલ્લું રહે છે. શું તમારે શનિવાર માટે સ્લોટ બુક કરવો છે?`;
      else if (lang === 'hi') reply = `शनिवार को हमारा क्लिनिक सुबह 9:00 से शाम 5:00 बजे तक खुला रहता है। क्या आपको शनिवार का समय चाहिए?`;

      return { replyText: reply, toolExecuted: 'query_saturday_hours', lang };
    }

    // 7. Price list / Consultancy fees / "suchi" / "price suchi tomorrow"
    if (lower.includes('suchi') || lower.includes('soochi') || lower.includes('su chi') || lower.includes('price list') || lower.includes('fees') || lower.includes('charges') || lower.includes('pricing') || lower.includes('ખર્ચ') || lower.includes('ભાવ')) {
      let reply = `Our consultation and digital X-ray fee is ₹500 ($50). For key treatments: Teeth Cleaning is ₹1,200, Single-Sitting Root Canal is ₹4,500, Zirconia Crown is ₹8,500, and Laser Whitening is ₹7,500. For tomorrow, we have slots at 10:00 AM and 3:00 PM. Which one would you prefer?`;
      if (lang === 'gu') reply = `હા ${salutationGu}, કન્સલ્ટેશન અને ડિજિટલ એક્સ-રેની ફી ₹500 છે. દાંતની સફાઈ ₹1,200, રૂટ કેનાલ ₹4,500, અને લેસર વ્હાઇટનિંગ ₹7,500 છે. કાલ માટે સવારે 10:00 AM અથવા બપોરે 3:00 PM નો સ્લોટ ખાલી છે. હું કયો સ્લોટ તમારા માટે બુક કરું?`;
      else if (lang === 'hi') reply = `जी ${salutationHi}, परामर्श और डिजिटल एक्स-रे की फीस ₹500 है। दांतों की सफाई ₹1,200, रूट कैनाल ₹4,500, और वाइटनिंग ₹7,500 है। कल के लिए सुबह 10:00 AM और दोपहर 3:00 PM का स्लॉट खाली है। कौन सा समय तय करूँ?`;

      return { replyText: reply, toolExecuted: 'query_price_list', lang };
    }

    // 8. "Which services do you provide?"
    if ((lower.includes('which') || lower.includes('what')) && (lower.includes('service') || lower.includes('treatment') || lower.includes('provide') || lower.includes('offer') || lower.includes('કઈ સેવા') || lower.includes('कौन सी सेवा'))) {
      let reply = `We offer comprehensive dental services: Consultation & Digital X-Rays, Teeth Cleaning & Whitening, Single-Sitting Root Canals, Ceramic/Zirconia Crowns, Invisible Aligners, Dental Implants, and Wisdom Tooth Extractions. Which of these can I tell you more about?`;
      if (lang === 'gu') reply = `અમે દાંતની સફાઈ, લેસર વ્હાઇટનિંગ, રૂટ કેનાલ, ઝિર્કોનિયા કેપ, ઇનવિઝિબલ બ્રેસિસ, ડેન્ટલ ઇમ્પ્લાન્ટ્સ અને ડહાપણની દાઢ કાઢવા સહિતની તમામ સેવાઓ આપીએ છીએ. તમને કઈ સેવા વિશે માહિતી જોઈએ છે?`;
      else if (lang === 'hi') reply = `हम दांतों की सफाई, वाइटनिंग, सिंगल-सिटिंग रूट कैनाल, कैप, अदृश्य ब्रेसेस, डेंटल इंप्लांट्स और अकल दाढ़ निकालने की सेवाएं देते हैं। आप किस उपचार के बारे में जानना चाहते हैं?`;

      return { replyText: reply, toolExecuted: 'list_services', lang };
    }

    // 9. "Tell me the doctor team name / specialised doctors"
    if (lower.includes('doctor') || lower.includes('specialist') || lower.includes('team') || lower.includes('ડૉક્ટર') || lower.includes('डॉक्टर')) {
      let reply = `Our specialist team includes Dr. Ananya Sharma (Orthodontist & Aligners), Dr. Rajesh Patel (Dental Implants & Surgery), Dr. Samir Mehta (Root Canal Specialist), and Dr. Priya Nair (Pediatric Child Dentist). Would you like to schedule an appointment with one of them?`;
      if (lang === 'gu') reply = `અમારી નિષ્ણાત ટીમમાં ડૉ. અનન્યા શર્મા (ઓર્થોડોન્ટિસ્ટ), ડૉ. રાજેશ પટેલ (ઇમ્પ્લાન્ટ સર્જન), ડૉ. સમીર મહેતા (રૂટ કેનાલ સ્પેશિયાલિસ્ટ), અને ડૉ. પ્રિયા નાયર (બાળકોના ડેન્ટિસ્ટ) છે. શું તમારે અપોઇન્ટમેન્ટ જોઈએ છે?`;
      else if (lang === 'hi') reply = `हमारे विशेषज्ञों में डॉ. अनन्या शर्मा (ऑर्थोडॉन्टिस्ट), डॉ. राजेश पटेल (इम्प्लांट सर्जन), डॉ. समीर मेहता (रूट कैनाल स्पेशलिस्ट), और डॉ. प्रिया नायर (बच्चों की डेंटिस्ट) शामिल हैं। क्या आप इनमें से किसी से मिलना चाहते हैं?`;

      return { replyText: reply, toolExecuted: 'list_doctors', lang };
    }

    // 10. Handle very short fragments or pauses (e.g. "your", "pandit", 1-2 words hesitation)
    const words = lower.split(/\s+/).filter((w) => w.length > 0);
    if (words.length <= 1 && !['hi', 'hello', 'bye', 'thanks', 'thank'].includes(lower)) {
      let reply = `Take your time, ${salutationEn}! I am right here listening whenever you're ready. What would you like to know?`;
      if (lang === 'gu') reply = `ચોક્કસ ${salutationGu}, હું સાંભળી રહી છું. આપ શાંતિથી જણાવી શકો છો, હું તમારી શું મદદ કરી શકું?`;
      else if (lang === 'hi') reply = `बिल्कुल ${salutationHi}, मैं सुन रही हूँ। आप आराम से बताएं, मैं आपकी क्या सहायता कर सकती हूँ?`;
      return { replyText: reply, lang };
    }

    // 11. Detect Appointment Booking intent (Multi-language)
    const isBooking = lower.includes('book') || lower.includes('appointment') || lower.includes('schedule') || 
      lower.includes('reserve') || lower.includes('અપોઇન્ટમેન્ટ') || lower.includes('બુક') || lower.includes('अपॉइंटमेंट') ||
      lower.includes('बुक') || lower.includes('हवी आहे') || lower.includes('करायचे');

    if (isBooking) {
      let service = 'General Consultation';
      if (lower.includes('dental') || lower.includes('teeth') || lower.includes('દાંત') || lower.includes('दांत')) service = 'Dental Consultation';
      else if (lower.includes('cleaning') || lower.includes('ક્લીનિંગ') || lower.includes('સફાઈ') || lower.includes('सफाई')) service = 'Dental Cleaning';
      else if (lower.includes('root canal') || lower.includes('rct')) service = 'Root Canal Treatment';
      else if (lower.includes('whitening')) service = 'Teeth Whitening';

      let dateTime = 'Tomorrow at 3:00 PM';
      if (lower.includes('today') || lower.includes('આજે') || lower.includes('आज')) dateTime = 'Today at 4:30 PM';
      else if (lower.includes('morning') || lower.includes('સવારે') || lower.includes('सुबह') || lower.includes('सकाळी')) dateTime = 'Tomorrow at 10:00 AM';

      const toolResult = await executeTool(
        'book_appointment',
        {
          customer_name: callerName || 'Valued Patient',
          service,
          date_time: dateTime,
          notes: `Booked via Local Simulator (${lang}): "${userText}"`
        },
        { callSid, callerPhone }
      );

      let replyText = `I have scheduled your ${service} for ${dateTime}, ${salutationEn}! You will receive a confirmation message shortly. Is there anything else I can arrange for you?`;
      if (lang === 'gu') {
        replyText = `મેં તમારા માટે ${dateTime} ના સમય પર ${service} ની અપોઇન્ટમેન્ટ બુક કરી લીધી છે, ${salutationGu}! તમને કન્ફર્મેશન મેસેજ મળશે. અન્ય કોઈ મદદ જોઈએ છે?`;
      } else if (lang === 'hi') {
        replyText = `मैंने आपके लिए ${dateTime} पर ${service} की अपॉइंटमेंट बुक कर दी है, ${salutationHi}! आपको जल्द ही पुष्टि का संदेश मिल जाएगा। क्या कुछ और मदद करूँ?`;
      }

      return { replyText, toolExecuted: 'book_appointment', toolResult, lang };
    }

    // 12. Knowledge Base Search Fallback
    const matchedDocs = knowledgeService.searchKnowledge(userText);
    if (matchedDocs.length > 0) {
      const doc = matchedDocs[0];
      const lines = doc.content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

      const queryWords = lower.replace(/[^\w\s\u0A80-\u0AFF\u0900-\u097F]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
      let bestLine = lines[0];
      let maxScore = -1;

      for (const line of lines) {
        const lineLower = line.toLowerCase();
        let score = 0;
        for (const w of queryWords) {
          const stem = w.length > 4 ? w.substring(0, 4) : w;
          if (lineLower.includes(w)) score += 4;
          else if (lineLower.includes(stem)) score += 2;
        }
        if (score > maxScore) {
          maxScore = score;
          bestLine = line;
        }
      }

      let replyText = `${bestLine}. Would you like any further details or help booking an appointment, ${salutationEn}?`;
      if (lang === 'gu') replyText = `${bestLine}. શું તમને વધુ વિગતો અથવા અપોઇન્ટમેન્ટ બુકિંગમાં મદદ જોઈએ છે, ${salutationGu}?`;
      else if (lang === 'hi') replyText = `${bestLine}। क्या आपको और कोई जानकारी चाहिए या अपॉइंटमेंट बुक करना है, ${salutationHi}?`;

      return { replyText, toolExecuted: 'query_knowledge_base', toolResult: { document: doc.title, snippet: bestLine }, lang };
    }

    // 13. Goodbyes / End Call
    if (lower.includes('bye') || lower.includes('thank you') || lower.includes('thanks') || lower.includes('goodbye') || lower.includes('આભાર') || lower.includes('ધન्यवाद') || lower.includes('शुक्रिया')) {
      let replyText = `You are very welcome, ${salutationEn}! Thank you for calling Aura Smiles. Have a healthy, wonderful day!`;
      if (lang === 'gu') replyText = `ખૂબ ખૂબ આભાર ${salutationGu}! ઔરા સ્માઈલ્સમાં કૉલ કરવા બદલ ધન્યવાદ. તમારો દિવસ મંગલમય રહે!`;
      else if (lang === 'hi') replyText = `आपका बहुत-बहुत धन्यवाद ${salutationHi}! ऑरा स्माइल्स में कॉल करने के लिए शुक्रिया। आपका दिन शुभ हो!`;
      return { replyText, lang };
    }

    // Default conversational fallback
    let replyText = `I understand, ${salutationEn}! I can help with treatment pricing, doctor availability, clinic timings, or booking a consultation. What would you like to know?`;
    if (lang === 'gu') replyText = `હું સમજી શકું છું, ${salutationGu}! હું અપોઇન્ટમેન્ટ બુકિંગ, સમય અથવા ભાવની વિગતોમાં તમારી મદદ કરી શકું છું. તમારે શું જાણવું છે?`;
    else if (lang === 'hi') replyText = `मैं समझ सकती हूँ, ${salutationHi}! मैं अपॉइंटमेंट बुक करने, समय या फीस की जानकारी में आपकी मदद कर सकती हूँ। आप क्या जानना चाहते हैं?`;

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
