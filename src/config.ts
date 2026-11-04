import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  publicUrl: process.env.PUBLIC_URL || '', // E.g., https://your-domain.ngrok-free.app or Railway URL

  // OpenAI Configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    realtimeModel: process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17',
    voice: process.env.AI_VOICE || 'alloy', // alloy, echo, shimmer, ash, ballad, coral, sage, verse
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
    systemPrompt: process.env.AI_SYSTEM_PROMPT || `You are "Aura", a warm, natural, and highly capable AI voice assistant.
Your goal is to assist callers in a friendly, concise, and conversational manner.
Guidelines:
- Keep responses short, natural, and conversational (1 to 2 sentences per turn is best for phone conversations).
- Do not use markdown, emojis, bullet points, or complex symbols in spoken text.
- If the user asks to book an appointment, check availability, or transfer to a human, use the provided tools.
- If you don't know the answer, be honest and offer to connect them to a specialist.`
  },

  // Twilio Telephony Configuration
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    humanTransferNumber: process.env.HUMAN_TRANSFER_NUMBER || ''
  }
};
