import { dbService, KnowledgeRecord } from '../db/database.js';

class KnowledgeService {
  /**
   * Search knowledge base for articles matching a caller query.
   */
  public searchKnowledge(query: string, maxResults: number = 3): KnowledgeRecord[] {
    const articles = dbService.getAllKnowledge();
    if (!articles.length || !query.trim()) return [];

    const queryWords = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (!queryWords.length) return articles.slice(0, maxResults);

    const scored = articles.map((article) => {
      let score = 0;
      const titleLower = article.title.toLowerCase();
      const contentLower = article.content.toLowerCase();

      for (const word of queryWords) {
        // High weight if word in title
        if (titleLower.includes(word)) score += 5;
        // Count occurrences in content
        const matches = (contentLower.match(new RegExp(word, 'g')) || []).length;
        score += matches;
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
