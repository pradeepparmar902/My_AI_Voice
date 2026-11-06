import OpenAI from 'openai';
import { config } from '../config.js';

class SummaryService {
  private openai: OpenAI | null = null;

  constructor() {
    if (config.openai.apiKey) {
      this.openai = new OpenAI({ apiKey: config.openai.apiKey });
    }
  }

  public async generateSummary(transcript: string, metadata?: any): Promise<{ summary: string; sentiment: string; actionItems: string[] }> {
    return this.analyzeCall(transcript);
  }

  public async analyzeCall(transcript: string): Promise<{ summary: string; sentiment: string; actionItems: string[] }> {
    if (!transcript || transcript.trim().length === 0) {
      return {
        summary: 'No conversation recorded or call was disconnected immediately.',
        sentiment: 'neutral',
        actionItems: []
      };
    }

    if (!this.openai) {
      // Fallback if no OpenAI API key provided yet
      return {
        summary: 'Call completed. (Add OPENAI_API_KEY to generate detailed AI summary).',
        sentiment: 'neutral',
        actionItems: []
      };
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an expert call analysis AI.
Analyze the following phone conversation transcript and return a JSON object with:
- "summary": A concise 2-3 sentence overview of the call and caller intent.
- "sentiment": One of "positive", "neutral", "negative", or "escalated".
- "actionItems": An array of strings describing any follow-up actions required.
Return strictly valid JSON only.`
          },
          {
            role: 'user',
            content: transcript
          }
        ],
        response_format: { type: 'json_object' }
      });

      const parsed = JSON.parse(response.choices[0].message.content || '{}');
      return {
        summary: parsed.summary || 'Summary unavailable.',
        sentiment: parsed.sentiment || 'neutral',
        actionItems: parsed.actionItems || []
      };
    } catch (err: any) {
      console.error('[SummaryService] Failed to analyze call:', err.message);
      return {
        summary: 'Automated analysis failed.',
        sentiment: 'neutral',
        actionItems: []
      };
    }
  }
}

export const summaryService = new SummaryService();
