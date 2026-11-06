import twilio from 'twilio';
import { config } from '../config.js';

class TwilioService {
  private client: twilio.Twilio | null = null;

  constructor() {
    if (config.twilio.accountSid && config.twilio.authToken) {
      this.client = twilio(config.twilio.accountSid, config.twilio.authToken);
    }
  }

  public isConfigured(): boolean {
    return !!(this.client && config.twilio.phoneNumber);
  }

  /**
   * Generates TwiML to connect the incoming or outbound call to our WebSocket Media Stream.
   */
  public generateMediaStreamTwiml(streamUrl: string, greetingText?: string): string {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();

    if (greetingText) {
      // Optional pre-stream speech or directly connect to WebSocket
      response.say({ voice: 'Polly.Joanna-Neural' }, greetingText);
    }

    const connect = response.connect();
    connect.stream({
      url: streamUrl
    });

    return response.toString();
  }

  /**
   * Initiates an outbound telephone call to a destination number.
   */
  public async makeOutboundCall(to: string, webhookUrl: string) {
    if (!this.client) {
      throw new Error('Twilio credentials not configured.');
    }

    // On Twilio Trial accounts, calling the verified recipient +919819984437 strictly requires
    // dialing from the assigned trial number +17372508034 (Error 573003).
    let fromNumber = config.twilio.phoneNumber || '+17372508034';
    if (to.replace(/\D/g, '').endsWith('9819984437')) {
      fromNumber = '+17372508034';
    }

    console.log(`[Twilio] Initiating outbound call from ${fromNumber} to ${to}...`);
    try {
      const call = await this.client.calls.create({
        to,
        from: fromNumber,
        url: webhookUrl
      });
      return call;
    } catch (err: any) {
      if (err.code === 573003 || err.message?.includes('not assigned')) {
        console.log('[Twilio] Error 573003 detected. Retrying with assigned trial sandbox number +17372508034...');
        const retryCall = await this.client.calls.create({
          to,
          from: '+17372508034',
          url: webhookUrl
        });
        return retryCall;
      }
      throw err;
    }
  }

  /**
   * Transfers a live call to a designated human operator or department.
   */
  public async transferCall(callSid: string, targetNumber?: string) {
    if (!this.client) {
      throw new Error('Twilio client not initialized.');
    }

    const dest = targetNumber || config.twilio.humanTransferNumber;
    if (!dest) {
      throw new Error('No transfer destination phone number provided in config.');
    }

    console.log(`[Twilio] Transferring call ${callSid} to ${dest}...`);

    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    response.say('Please hold while we transfer your call to our specialist.');
    response.dial(dest);

    await this.client.calls(callSid).update({
      twiml: response.toString()
    });
  }

  /**
   * Sends an SMS text message to the caller.
   */
  public async sendSms(to: string, body: string) {
    if (!this.client || !config.twilio.phoneNumber) {
      throw new Error('Twilio is not configured to send SMS.');
    }

    return await this.client.messages.create({
      to,
      from: config.twilio.phoneNumber,
      body
    });
  }
}

export const twilioService = new TwilioService();
