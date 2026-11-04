import { dbService } from '../db/database.js';
import { executeTool } from './tools.service.js';
import { knowledgeService } from './knowledge.service.js';

interface SimulatorMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
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
  ): Promise<{ replyText: string; toolExecuted?: string; toolResult?: any }> {
    const lower = userText.toLowerCase().trim();

    // 1. Detect Appointment Booking intent
    if (lower.includes('book') || lower.includes('appointment') || lower.includes('schedule') || lower.includes('reserve')) {
      // Extract service/reason
      let service = 'General Consultation';
      if (lower.includes('dental') || lower.includes('teeth')) service = 'Dental Consultation';
      else if (lower.includes('demo') || lower.includes('sales')) service = 'Product Demo';
      else if (lower.includes('cleaning')) service = 'Dental Cleaning';

      // Extract time/date
      let dateTime = 'Tomorrow at 3:00 PM';
      if (lower.includes('today')) dateTime = 'Today at 4:30 PM';
      else if (lower.includes('monday')) dateTime = 'Monday at 10:00 AM';
      else if (lower.includes('friday')) dateTime = 'Friday at 2:00 PM';
      else if (lower.includes('morning')) dateTime = 'Tomorrow at 10:00 AM';

      const toolResult = await executeTool(
        'book_appointment',
        {
          customer_name: 'Local Test User',
          service,
          date_time: dateTime,
          notes: `Booked via Local Simulator: "${userText}"`
        },
        { callSid, callerPhone }
      );

      return {
        replyText: `I have scheduled your ${service} for ${dateTime}. You will receive a confirmation shortly! Is there anything else I can assist you with?`,
        toolExecuted: 'book_appointment',
        toolResult
      };
    }

    // 2. Detect Availability check
    if (lower.includes('available') || lower.includes('open slots') || lower.includes('time') || lower.includes('slots')) {
      const toolResult = await executeTool(
        'check_availability',
        { date: 'tomorrow' },
        { callSid, callerPhone }
      );

      return {
        replyText: 'For tomorrow, we currently have openings at 10:00 AM, 1:30 PM, 3:00 PM, and 4:30 PM. Which of those works best for you?',
        toolExecuted: 'check_availability',
        toolResult
      };
    }

    // 3. Detect Call Transfer intent
    if (lower.includes('human') || lower.includes('operator') || lower.includes('supervisor') || lower.includes('agent') || lower.includes('representative')) {
      return {
        replyText: 'I completely understand. Please hold for just a moment while I transfer you directly to our human specialist.',
        toolExecuted: 'transfer_call_to_human',
        toolResult: { success: true, message: 'Transfer simulated.' }
      };
    }

    // 4. Detect Customer Lookup
    if (lower.includes('who am i') || lower.includes('lookup') || lower.includes('my details') || lower.includes('profile')) {
      const toolResult = await executeTool('lookup_customer', { phone: callerPhone }, { callSid, callerPhone });
      if (toolResult.found) {
        return {
          replyText: `I found your file! You are registered as ${toolResult.name}, with notes: ${toolResult.notes || 'None'}. How can I help you today?`,
          toolExecuted: 'lookup_customer',
          toolResult
        };
      }
      return {
        replyText: `You are connected from ${callerPhone}. I see you are a new customer. How can I assist you today?`,
        toolExecuted: 'lookup_customer',
        toolResult
      };
    }

    // 5. Query Knowledge Base for Company Information, FAQs, Pricing, Hours, Policies
    const matchedDocs = knowledgeService.searchKnowledge(userText);
    if (matchedDocs.length > 0) {
      const doc = matchedDocs[0];
      // Pick key content or concise snippet
      const lines = doc.content.split('\n').filter((l) => l.trim().length > 0);
      let matchedSentence = lines[0];

      // Try finding the exact line containing query terms
      const queryWords = lower.split(/\s+/).filter((w) => w.length > 3);
      for (const line of lines) {
        const lineLower = line.toLowerCase();
        if (queryWords.some((w) => lineLower.includes(w))) {
          matchedSentence = line;
          break;
        }
      }

      return {
        replyText: `According to our ${doc.title}: ${matchedSentence}. Would you like any further details or help scheduling an appointment?`,
        toolExecuted: 'query_knowledge_base',
        toolResult: { document: doc.title, snippet: matchedSentence }
      };
    }

    // 6. Greeting intents
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey') || lower.length === 0) {
      return {
        replyText: "Hello! This is Aura, your AI voice assistant. I can help you schedule appointments, look up your account, or answer your questions. What can I do for you today?"
      };
    }

    // 6. Goodbyes / End Call
    if (lower.includes('bye') || lower.includes('thank you') || lower.includes('thanks') || lower.includes('goodbye')) {
      return {
        replyText: "You are very welcome! Thank you for calling. Have a wonderful rest of your day!"
      };
    }

    // Default intelligent conversational fallback
    return {
      replyText: `I understand you mentioned: "${userText}". I can help book a consultation, check available dates, or connect you to an agent. Would you like to schedule a slot?`
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
