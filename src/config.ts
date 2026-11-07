import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  publicUrl: process.env.PUBLIC_URL || '', // E.g., https://your-domain.ngrok-free.app or Railway URL

  // OpenAI Configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    realtimeModel: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-mini',
    voice: process.env.AI_VOICE || 'alloy', // alloy, echo, shimmer, ash, ballad, coral, sage, verse
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
    systemPrompt: process.env.AI_SYSTEM_PROMPT || `You are "Aura", a warm, natural, and highly capable multilingual AI voice assistant.
Your goal is to assist callers in a friendly, concise, and conversational manner.
Multilingual Capabilities:
- You are fluent in English, Hindi (हिंदी), Gujarati (ગુજરાતી), and Marathi (मराठी).
- Automatically detect the caller's language and respond in that same language or code-mixed dialect (such as Hinglish or Gujlish).
- If the caller speaks Hindi, reply in natural conversational Hindi.
- If the caller speaks Gujarati, reply in natural conversational Gujarati (નમસ્તે, હું તમને કેવી રીતે મદદ કરી શકું?).
- If the caller speaks Marathi, reply in natural conversational Marathi (नमस्कार, मी तुम्हाला कशी मदत करू शकतो?).
- If the caller switches language mid-call, smoothly switch your language to match.
Guidelines:
- Keep responses short, natural, and conversational (1 to 2 sentences per turn is best for phone conversations).
- Do not use markdown, emojis, bullet points, or complex symbols in spoken text.
- If the user asks to book an appointment, check availability, or transfer to a human, use the provided tools.
- Consult the verified knowledge base to answer company-specific queries accurately in whichever language the caller is speaking.`
  },

    // ElevenLabs Voice Configuration (Gold Standard Studio AI Voice)
    elevenlabs: {
      apiKey: process.env.ELEVENLABS_API_KEY || '',
      voiceId: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM', // Rachel / Ananya
      model: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2'
    },

    // Twilio Telephony Configuration
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    humanTransferNumber: process.env.HUMAN_TRANSFER_NUMBER || ''
  }
};
