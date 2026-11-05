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
  if (/\b(namaskar|kase|aahat|karaycha|karaychi|pahije|kiti|udya|ahe|kashi)\b/.test(lower) || (/[\u0900-\u097F]/.test(text) && /\b(आहे|कसे|कशी|करा|पाहिजे|उद्या|किती)\b/.test(text))) {
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

    // Normalize common speech-to-text misrecognitions (e.g. "tooth egg" -> "toothache")
    if (lower.includes('tooth egg') || lower.includes('tooth ace') || lower.includes('teeth egg') || lower.includes('tooth ake')) {
      lower = lower.replace(/tooth (egg|ace|ake)|teeth egg/g, 'toothache');
    }

    // 1. User Name Introduction ("my name is ...", "I am ...")
    const nameMatch = userText.match(/(?:my name is|i am|this is|call me)\s+([A-Za-z\u0A80-\u0AFF\u0900-\u097F\s]{2,25})/i);
    if (nameMatch && !lower.includes('book') && !lower.includes('appointment')) {
      const extractedName = nameMatch[1].trim().replace(/(please|here|calling).*$/i, '').trim();
      dbService.upsertContact(callerPhone, extractedName, 'Identified via Voice Call');

      let reply = `Nice to meet you, ${extractedName}! Welcome to Aura Smiles Dental Clinic. How can I assist you with your dental care today?`;
      if (lang === 'gu') reply = `નમસ્તે ${extractedName} ભાઈ/બહેન! ઔરા સ્માઈલ્સ ડેન્ટલ ક્લિનિકમાં આપનું સ્વાગત છે. હું તમારી શું મદદ કરી શકું?`;
      else if (lang === 'hi') reply = `नमस्ते ${extractedName} जी! ऑरा स्माइल्स डेंटल में आपका स्वागत है। बताइए, मैं आपकी क्या सहायता करूँ?`;
      else if (lang === 'mr') reply = `नमस्कार ${extractedName} जी! ऑरा स्माइल्स डेंटल क्लिनिकमध्ये आपले स्वागत आहे. सांगा, मी कशी मदत करू?`;

      return { replyText: reply, toolExecuted: 'identify_caller', toolResult: { name: extractedName }, lang };
    }

    // 2. Toothache / Dental Pain / Symptoms ("I have a toothache", "pain in teeth", "tooth egg")
    if (lower.includes('toothache') || lower.includes('pain') || lower.includes('swelling') || lower.includes('bleeding') || lower.includes('sensitivity') || lower.includes('દાંતમાં દુખાવો') || lower.includes('दांत में दर्द') || lower.includes('दाढ दुखी')) {
      let reply = `I'm sorry to hear you're in pain! For a toothache, we recommend coming in for a ₹500 digital X-ray and checkup with Dr. Samir or Dr. Rajesh to identify if it requires a filling, deep cleaning, or root canal. Would you like me to schedule an immediate consultation for you today?`;
      if (lang === 'gu') reply = `દાંતમાં દુખાવા માટે ખેદ છે. અમારા નિષ્ણાત ડૉક્ટર પાસે ₹500 માં ડિજિટલ એક્સ-રે અને તપાસ કરાવી લેવી જોઈએ જેથી યોગ્ય સારવાર થઈ શકે. શું હું તમારા માટે આજનો સ્લોટ બુક કરું?`;
      else if (lang === 'hi') reply = `दांत के दर्द के लिए खेद है। हम आपको ₹500 में डिजिटल एक्स-रे और डॉक्टर से जांच कराने की सलाह देते हैं ताकि सही इलाज हो सके। क्या मैं आपके लिए आज का समय बुक करूँ?`;
      else if (lang === 'mr') reply = `दातदुखीसाठी कृपया क्लिनिकमध्ये येऊन डिजिटल एक्स-रे आणि तपासणी (₹500) करून घ्या. मी आजची अपॉइंटमेंट बुक करू का?`;

      return { replyText: reply, toolExecuted: 'triage_symptom', toolResult: { symptom: 'toothache' }, lang };
    }

    // 3. "Which services do you provide?" / Treatments offered
    if ((lower.includes('which') || lower.includes('what')) && (lower.includes('service') || lower.includes('treatment') || lower.includes('provide') || lower.includes('offer') || lower.includes('કઈ સેવા') || lower.includes('कौन सी सेवा'))) {
      let reply = `We provide complete dental care including General Consultations & X-Rays, Teeth Cleaning & Laser Whitening, Single-Sitting Root Canals, Zirconia Crowns, Invisible Aligners, Dental Implants, and Wisdom Tooth Extractions. Which treatment are you interested in?`;
      if (lang === 'gu') reply = `અમે દાંતની સફાઈ, લેસર વ્હાઇટનિંગ, રૂટ કેનાલ, ઝિર્કોનિયા કેપ, ઇનવિઝિબલ બ્રેસિસ, ડેન્ટલ ઇમ્પ્લાન્ટ્સ અને ડહાપણની દાઢ કાઢવા સહિતની તમામ સારવાર આપીએ છીએ. તમને કઈ સારવાર વિશે જાણવું છે?`;
      else if (lang === 'hi') reply = `हम दांतों की सफाई, लेजर वाइटनिंग, रूट कैनाल, कैप, इनविजिबल ब्रेसेस, डेंटल इंप्लांट्स और अकल दाढ़ निकालने सहित सभी सेवाएं प्रदान करते हैं। आप किस उपचार के बारे में जानना चाहते हैं?`;
      else if (lang === 'mr') reply = `आम्ही दात साफ करणे, व्हाईटनिंग, रूट कॅनॉल, कॅप्स, ब्रेसेस, आणि डेंटल रोपण या सर्व सेवा देतो. आपल्याला कशाबद्दल माहिती हवी आहे?`;

      return { replyText: reply, toolExecuted: 'list_services', lang };
    }

    // 4. "Tell me the doctor team name / specialised doctors"
    if (lower.includes('doctor') || lower.includes('specialist') || lower.includes('team') || lower.includes('ડૉક્ટર') || lower.includes('डॉक्टर')) {
      let reply = `Our specialist team includes Dr. Ananya Sharma (Chief Orthodontist & Aligners), Dr. Rajesh Patel (Implantologist & Oral Surgeon), Dr. Samir Mehta (Root Canal Specialist), and Dr. Priya Nair (Pediatric Child Dentist). Would you like to consult one of them?`;
      if (lang === 'gu') reply = `અમારી ટીમમાં ડૉ. અનન્યા શર્મા (ઓર્થોડોન્ટિસ્ટ), ડૉ. રાજેશ પટેલ (ઇમ્પ્લાન્ટ સ્પેશિયાલિસ્ટ), ડૉ. સમીર મહેતા (રૂટ કેનાલ એક્સપર્ટ), અને ડૉ. પ્રિયા નાયર (બાળકોના ડેન્ટિસ્ટ) છે. શું તમારે અપોઇન્ટમેન્ટ જોઈએ છે?`;
      else if (lang === 'hi') reply = `हमारे विशेषज्ञों में डॉ. अनन्या शर्मा (ऑर्थोडॉन्टिस्ट), डॉ. राजेश पटेल (इम्प्लांट सर्जन), डॉ. समीर मेहता (रूट कैनाल स्पेशलिस्ट), और डॉ. प्रिया नायर (बच्चों की डेंटिस्ट) शामिल हैं।`;
      else if (lang === 'mr') reply = `आमच्या तज्ज्ञ चमूमध्ये डॉ. अनन्या शर्मा, डॉ. राजेश पटेल, डॉ. समीर मेहता आणि डॉ. प्रिया नायर आहेत.`;

      return { replyText: reply, toolExecuted: 'list_doctors', lang };
    }

    // 5. "Comprehensive treatment pricing list" / Price Overview
    if ((lower.includes('price') || lower.includes('pricing') || lower.includes('cost') || lower.includes('charges') || lower.includes('fees') || lower.includes('ખર્ચ') || lower.includes('फीस')) && 
        (lower.includes('list') || lower.includes('all') || lower.includes('menu') || lower.includes('comprehensive') || lower.includes('બધા') || lower.includes('કુલ'))) {
      let reply = `Here are our key treatment fees: Consultation & Digital X-Ray is ₹500, Teeth Cleaning is ₹1,200, Single-Sitting Root Canal is ₹4,500, Zirconia Crown is ₹8,500, Laser Whitening is ₹7,500, and Implants start at ₹25,000. 0% EMI is also available!`;
      if (lang === 'gu') reply = `અમારા મુખ્ય દરો: કન્સલ્ટેશન ₹500, દાંતની સફાઈ ₹1,200, રૂટ કેનાલ ₹4,500, ઝિર્કોનિયા કેપ ₹8,500, વ્હાઇટનિંગ ₹7,500, અને ઇમ્પ્લાન્ટ્સ ₹25,000 થી શરૂ થાય છે. 0% વ્યાજની EMI પણ ઉપલબ્ધ છે!`;
      else if (lang === 'hi') reply = `मुख्य शुल्क: परामर्श ₹500, दांतों की सफाई ₹1,200, रूट कैनाल ₹4,500, कैप ₹8,500, वाइटनिंग ₹7,500, और इंप्लांट्स ₹25,000 से शुरू हैं। 0% EMI सुविधा भी उपलब्ध है!`;

      return { replyText: reply, toolExecuted: 'list_pricing', lang };
    }

    // 6. Specific Day Timing: Sunday
    if (lower.includes('sunday') || lower.includes('રવિવાર') || lower.includes('रविवार')) {
      let reply = `On Sundays, our clinic is open from 10:00 AM to 2:00 PM for specialist consultations and emergency appointments. Emergency on-call is also active 24/7 at +91 98765 43210.`;
      if (lang === 'gu') reply = `રવિવારે અમારું ક્લિનિક સવારે 10:00 થી બપોરે 2:00 વાગ્યા સુધી ખુલ્લું રહે છે. ઈમરજન્સી સેવા 24 કલાક ઉપલબ્ધ છે.`;
      else if (lang === 'hi') reply = `रविवार को क्लीनिक सुबह 10:00 बजे से दोपहर 2:00 बजे तक खुला रहता है। आपातकालीन सेवा 24 घंटे चालू है।`;

      return { replyText: reply, toolExecuted: 'query_sunday_hours', lang };
    }

    // 7. Specific Day Timing: Saturday
    if (lower.includes('saturday') || lower.includes('શનિવાર') || lower.includes('शनिवार')) {
      let reply = `On Saturdays, we are open from 9:00 AM to 5:00 PM. Would you like to reserve a slot for Saturday?`;
      if (lang === 'gu') reply = `શનિવારે ક્લિનિક સવારે 9:00 થી સાંજે 5:00 વાગ્યા સુધી ખુલ્લું રહે છે. શું તમારે શનિવાર માટે સ્લોટ બુક કરવો છે?`;
      else if (lang === 'hi') reply = `शनिवार को क्लीनिक सुबह 9:00 से शाम 5:00 बजे तक खुला रहता है। क्या आपको शनिवार के लिए समय चाहिए?`;

      return { replyText: reply, toolExecuted: 'query_saturday_hours', lang };
    }

    // 8. General Opening / Closing Hours
    if ((lower.includes('open') || lower.includes('close') || lower.includes('timing') || lower.includes('hours') || lower.includes('સમય') || lower.includes('समय')) && !lower.includes('slot')) {
      let reply = `Our regular clinic hours are Monday to Friday 8:00 AM to 8:00 PM, Saturday 9:00 AM to 5:00 PM, and Sunday 10:00 AM to 2:00 PM.`;
      if (lang === 'gu') reply = `અમારો સમય સોમવાર થી શુક્રવાર સવારે 8:00 થી રાત્રે 8:00, શનિવારે 9:00 થી 5:00, અને રવિવારે સવારે 10:00 થી બપોરે 2:00 વાગ્યાનો છે.`;
      else if (lang === 'hi') reply = `हमारा समय सोमवार से शुक्रवार सुबह 8:00 से रात 8:00 बजे, शनिवार सुबह 9:00 से शाम 5:00 बजे, और रविवार सुबह 10:00 से 2:00 बजे तक है।`;

      return { replyText: reply, toolExecuted: 'query_general_hours', lang };
    }

    // 9. Detect Appointment Booking intent (Multi-language)
    const isBooking = lower.includes('book') || lower.includes('appointment') || lower.includes('schedule') || 
      lower.includes('reserve') || lower.includes('અપોઇન્ટમેન્ટ') || lower.includes('બુક') || lower.includes('अपॉइंटमेंट') ||
      lower.includes('बुक') || lower.includes('हवी आहे') || lower.includes('करायचे');

    if (isBooking) {
      let service = 'General Consultation';
      if (lower.includes('dental') || lower.includes('teeth') || lower.includes('દાંત') || lower.includes('दांत')) service = 'Dental Consultation';
      else if (lower.includes('cleaning') || lower.includes('ક્લીનિંગ') || lower.includes('સફાઈ') || lower.includes('सफाई')) service = 'Dental Cleaning';
      else if (lower.includes('root canal') || lower.includes('rct')) service = 'Root Canal Treatment';
      else if (lower.includes('whitening')) service = 'Teeth Whitening';
      else if (lower.includes('demo') || lower.includes('sales')) service = 'Product Demo';

      let dateTime = 'Tomorrow at 3:00 PM';
      if (lower.includes('today') || lower.includes('આજે') || lower.includes('आज')) dateTime = 'Today at 4:30 PM';
      else if (lower.includes('morning') || lower.includes('સવારે') || lower.includes('सुबह') || lower.includes('सकाळी')) dateTime = 'Tomorrow at 10:00 AM';

      // Pull customer name from DB if known
      const existing = dbService.getContactByPhone(callerPhone);
      const customerName = existing && existing.name ? existing.name : 'Valued Patient';

      const toolResult = await executeTool(
        'book_appointment',
        {
          customer_name: customerName,
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

    // 10. Detect Availability check (only when asking for open slots or appointment openings)
    const isAvail = (lower.includes('slots') || lower.includes('slot') || lower.includes('available slots') || 
      lower.includes('openings') || lower.includes('when can i come') || lower.includes('ક્યારે આવી શકું') || 
      lower.includes('સ્લોટ') || lower.includes('स्लॉट'));

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

    // 11. Detect Call Transfer intent
    const isTransfer = lower.includes('human') || lower.includes('operator') || lower.includes('supervisor') || 
      lower.includes('agent') || lower.includes('representative') || lower.includes('માણસ') || lower.includes('इंसान') || lower.includes('व्यक्ती');

    if (isTransfer) {
      let replyText = 'I completely understand. Please hold for just a moment while I transfer you directly to our clinic receptionist.';
      if (lang === 'gu') {
        replyText = 'ચોક્કસ, કૃપા કરીને થોડી ક્ષણ રાહ જુઓ, હું તમારો કૉલ અમારા રિસેપ્શનિસ્ટને ટ્રાન્સફર કરી રહી છું.';
      } else if (lang === 'hi') {
        replyText = 'जी बिल्कुल, कृपया एक क्षण प्रतीक्षा करें, मैं आपका कॉल हमारे क्लिनिक रिसेप्शनिस्ट को ट्रांसफर कर रही हूँ।';
      } else if (lang === 'mr') {
        replyText = 'नक्कीच, कृपया एक क्षण थांबा, मी आपला कॉल आमच्या प्रतिनिधीकडे वर्ग करत आहे.';
      }
      return { replyText, toolExecuted: 'transfer_call_to_human', toolResult: { success: true }, lang };
    }

    // 12. Query Knowledge Base for any specific service/item
    const matchedDocs = knowledgeService.searchKnowledge(userText);
    if (matchedDocs.length > 0) {
      const doc = matchedDocs[0];
      const lines = doc.content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

      // Score lines to find the exact matching answer line
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

      let replyText = `${bestLine}. Would you like any further details or help booking an appointment?`;
      if (lang === 'gu') {
        replyText = `${bestLine}. શું તમને વધુ વિગતો અથવા અપોઇન્ટમેન્ટ બુકિંગમાં મદદ જોઈએ છે?`;
      } else if (lang === 'hi') {
        replyText = `${bestLine}। क्या आपको और कोई जानकारी चाहिए या अपॉइंटमेंट बुक करना है?`;
      } else if (lang === 'mr') {
        replyText = `${bestLine}. अजून काही माहिती किंवा अपॉइंटमेंट हवी आहे का?`;
      }

      return {
        replyText,
        toolExecuted: 'query_knowledge_base',
        toolResult: { document: doc.title, snippet: bestLine },
        lang
      };
    }

    // 13. Greeting intents
    const isGreeting = lower.includes('hello') || lower.includes('hi') || lower.includes('hey') || 
      lower.includes('નમસ્તે') || lower.includes('કેમ છો') || lower.includes('kem cho') ||
      lower.includes('नमस्ते') || lower.includes('नमस्कार') || lower.includes('namaste') || lower.length === 0;

    if (isGreeting) {
      let replyText = "Hello! This is Aura, your AI dental assistant at Aura Smiles. How can I help you with your teeth today?";
      if (lang === 'gu') {
        replyText = "નમસ્તે! હું ઓરા છું, ઔરા સ્માઈલ્સ ડેન્ટલ ક્લિનિકથી. હું તમને કેવી રીતે મદદ કરી શકું?";
      } else if (lang === 'hi') {
        replyText = "नमस्ते! मैं ऑरा हूँ, ऑरा स्माइल्स डेंटल क्लिनिक से। बताइए, मैं आपकी क्या सहायता करूँ?";
      } else if (lang === 'mr') {
        replyText = "नमस्कार! मी ऑरा, ऑरा स्माइल्स डेंटल क्लिनिकमधून. मी तुम्हाला कशी मदत करू शकते?";
      }
      return { replyText, lang };
    }

    // 14. Goodbyes / End Call
    if (lower.includes('bye') || lower.includes('thank you') || lower.includes('thanks') || lower.includes('goodbye') || lower.includes('આભાર') || lower.includes('ધન्यवाद') || lower.includes('शुक्रिया')) {
      let replyText = "You are very welcome! Thank you for calling Aura Smiles. Have a healthy, smiling day!";
      if (lang === 'gu') replyText = "ખૂબ ખૂબ આભાર! ઔરા સ્માઈલ્સમાં કૉલ કરવા બદલ ધન્યવાદ. તમારો દિવસ સુંદર રહે!";
      else if (lang === 'hi') replyText = "आपका बहुत-बहुत धन्यवाद! ऑरा स्माइल्स में कॉल करने के लिए शुक्रिया। आपका दिन शुभ हो!";
      else if (lang === 'mr') replyText = "ખૂબ ખૂબ धन्यवाद! आपला दिवस आनंदी जावो!";
      return { replyText, lang };
    }

    // Default intelligent conversational fallback
    let replyText = `I understand you mentioned: "${userText}". I can help book a dental consultation, check clinic timings, or quote treatment pricing. What would you like to know?`;
    if (lang === 'gu') {
      replyText = `હું સમજી શકું છું. હું અપોઇન્ટમેન્ટ બુકિંગ, સમય અથવા ભાવની વિગતોમાં તમારી મદદ કરી શકું છું. તમારે શું જાણવું છે?`;
    } else if (lang === 'hi') {
      replyText = `मैं समझ सकती हूँ। मैं अपॉइंटमेंट बुक करने, समय या फीस की जानकारी में आपकी मदद कर सकती हूँ। आप क्या जानना चाहते हैं?`;
    } else if (lang === 'mr') {
      replyText = `मी समजू शकते. मी अपॉइंटमेंट, वेळ किंवा खर्चाबद्दल माहिती देऊ शकते. आपल्याला काय जाणून घ्यायचे आहे?`;
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
