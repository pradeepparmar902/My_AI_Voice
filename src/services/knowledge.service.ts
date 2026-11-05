import { dbService, KnowledgeRecord } from '../db/database.js';

class KnowledgeService {
  /**
   * Search knowledge base for articles matching a caller query.
   */
  public searchKnowledge(query: string, maxResults: number = 3): KnowledgeRecord[] {
    const articles = dbService.getAllKnowledge();
    if (!articles.length || !query.trim()) return [];

    // Clean and stem query words (min 3 chars)
    const queryWords = query
      .toLowerCase()
      .replace(/[^\w\s\u0A80-\u0AFF\u0900-\u097F]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3);

    if (!queryWords.length) return articles.slice(0, maxResults);

    const scored = articles.map((article) => {
      let score = 0;
      const titleLower = article.title.toLowerCase();
      const contentLower = article.content.toLowerCase();

      for (const word of queryWords) {
        // Base stem (first 4-5 chars for prefix matching, e.g. "consult", "clean", "whiten", "pric", "open", "hour")
        const stem = word.length > 4 ? word.substring(0, 4) : word;

        // Exact match in title
        if (titleLower.includes(word)) score += 10;
        else if (titleLower.includes(stem)) score += 6;

        // Count exact occurrences in content
        const exactMatches = (contentLower.match(new RegExp(word, 'g')) || []).length;
        score += exactMatches * 3;

        // Count stem occurrences in content
        const stemMatches = (contentLower.match(new RegExp(stem, 'g')) || []).length;
        score += stemMatches * 1;
      }

      return { article, score };
    });

    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map((item) => item.article);
  }

  /**
   * Generates a concise context block for prompt injection.
   */
  public getFormattedKnowledgeContext(): string {
    const articles = dbService.getAllKnowledge();
    if (!articles.length) return '';

    const formatted = articles
      .map((doc) => `--- [DOC: ${doc.title}] ---\n${doc.content.trim()}`)
      .join('\n\n');

    return `\n\n=== VERIFIED COMPANY KNOWLEDGE BASE ===\nUse the following verified facts to accurately answer caller inquiries:\n${formatted}\n=======================================\n`;
  }
}

export const knowledgeService = new KnowledgeService();
