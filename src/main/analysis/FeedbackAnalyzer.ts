/**
 * FeedbackAnalyzer - AI-Powered Feedback Categorization
 *
 * Hybrid rule-based + AI approach for categorizing user feedback:
 * 1. Fast rule-based matching for clear cases (high confidence)
 * 2. AI fallback for ambiguous cases (future enhancement)
 *
 * Categories: bug, ux-issue, suggestion, performance, question, general
 * Severity: critical, high, medium, low
 */

// =============================================================================
// Types
// =============================================================================

export type FeedbackCategory =
  | 'bug'
  | 'ux-issue'
  | 'suggestion'
  | 'performance'
  | 'question'
  | 'general';

export type FeedbackSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface AnalysisResult {
  category: FeedbackCategory;
  categoryConfidence: number; // 0-1
  severity: FeedbackSeverity;
  severityConfidence: number; // 0-1
  keywords: string[];
  suggestedTitle: string;
  // Analysis metadata
  matchedPatterns: string[];
  processingTimeMs: number;
}

interface PatternMatch {
  pattern: RegExp;
  weight: number;
  label: string;
}

interface CategoryScore {
  category: FeedbackCategory;
  score: number;
  matches: string[];
}

interface SeverityScore {
  severity: FeedbackSeverity;
  score: number;
  matches: string[];
}

// =============================================================================
// Pattern Definitions
// =============================================================================

/**
 * Category patterns with weighted scoring
 * Higher weight = stronger signal for that category
 */
const CATEGORY_PATTERNS: Record<FeedbackCategory, PatternMatch[]> = {
  bug: [
    // Strong indicators - explicit bug language
    { pattern: /\bbug\b/i, weight: 0.5, label: 'bug-explicit' },
    { pattern: /\b(broken|crash(ed|es|ing)?)\b/i, weight: 0.4, label: 'broken-crash' },
    { pattern: /\bdoesn'?t work\b/i, weight: 0.35, label: 'doesnt-work' },
    { pattern: /\bnot working\b/i, weight: 0.35, label: 'not-working' },
    { pattern: /\berror\b/i, weight: 0.3, label: 'error' },
    { pattern: /\bfail(s|ed|ing)?\b/i, weight: 0.25, label: 'fail' },
    { pattern: /\bdoesn'?t match\b/i, weight: 0.3, label: 'doesnt-match' },
    // Medium indicators
    { pattern: /\b(wrong|incorrect)\b/i, weight: 0.2, label: 'wrong' },
    { pattern: /\bunexpected(ly)?\b/i, weight: 0.2, label: 'unexpected' },
    { pattern: /\bshould(n'?t| not) (be|have|do)\b/i, weight: 0.25, label: 'should-not' },
    { pattern: /\bissue\b/i, weight: 0.15, label: 'issue' },
    { pattern: /\bbehavior\b/i, weight: 0.1, label: 'behavior' },
    // Weak indicators
    { pattern: /\b(stuck|frozen|hang(s|ing)?)\b/i, weight: 0.2, label: 'stuck' },
    { pattern: /\bglitch(y|es)?\b/i, weight: 0.25, label: 'glitch' },
  ],

  'ux-issue': [
    // Strong indicators
    { pattern: /\bconfusing\b/i, weight: 0.35, label: 'confusing' },
    { pattern: /\bhard to (find|use|understand)\b/i, weight: 0.35, label: 'hard-to' },
    { pattern: /\b(ux|user experience)\b/i, weight: 0.4, label: 'ux-term' },
    { pattern: /\bnot (intuitive|obvious|clear)\b/i, weight: 0.35, label: 'not-intuitive' },
    // Medium indicators
    { pattern: /\b(awkward|clunky|cumbersome)\b/i, weight: 0.3, label: 'awkward' },
    { pattern: /\b(annoying|frustrating|painful)\b/i, weight: 0.25, label: 'frustrating' },
    { pattern: /\bunclear\b/i, weight: 0.25, label: 'unclear' },
    { pattern: /\bwhere (is|are|do|can)\b/i, weight: 0.2, label: 'where-is' },
    { pattern: /\bcan'?t find\b/i, weight: 0.3, label: 'cant-find' },
    // Weak indicators
    { pattern: /\b(hidden|buried)\b/i, weight: 0.2, label: 'hidden' },
    { pattern: /\b(cluttered|messy|crowded)\b/i, weight: 0.2, label: 'cluttered' },
  ],

  suggestion: [
    // Strong indicators
    { pattern: /\b(should|could) (add|have|include|be)\b/i, weight: 0.35, label: 'should-add' },
    { pattern: /\bwould be (nice|great|better|helpful)\b/i, weight: 0.4, label: 'would-be-nice' },
    { pattern: /\b(suggest|idea|feature request)\b/i, weight: 0.4, label: 'suggest' },
    { pattern: /\bwish (there was|it had|you could)\b/i, weight: 0.35, label: 'wish' },
    { pattern: /\bit would be (nice|great)\b/i, weight: 0.4, label: 'it-would-be' },
    { pattern: /\byou should add\b/i, weight: 0.45, label: 'you-should-add' },
    { pattern: /\bcould you add\b/i, weight: 0.4, label: 'could-you-add' },
    // Medium indicators
    { pattern: /\b(add|implement|include|consider) (a |the |an )/i, weight: 0.3, label: 'add-article' },
    { pattern: /\bwhat (if|about)\b/i, weight: 0.25, label: 'what-if' },
    { pattern: /\bhow about\b/i, weight: 0.3, label: 'how-about' },
    { pattern: /\bmaybe (add|have|include)\b/i, weight: 0.3, label: 'maybe-add' },
    { pattern: /\bability to\b/i, weight: 0.25, label: 'ability-to' },
    { pattern: /\ba way to\b/i, weight: 0.25, label: 'a-way-to' },
    // Weak indicators
    { pattern: /\b(nice to have|would love)\b/i, weight: 0.25, label: 'nice-to-have' },
    { pattern: /\benhance(ment)?\b/i, weight: 0.2, label: 'enhance' },
  ],

  performance: [
    // Strong indicators
    { pattern: /\b(slow|sluggish)\b/i, weight: 0.4, label: 'slow' },
    { pattern: /\bperformance\b/i, weight: 0.35, label: 'performance' },
    { pattern: /\b(lag(gy|s|ging)?)\b/i, weight: 0.35, label: 'lag' },
    { pattern: /\btakes (forever|too long|a while)\b/i, weight: 0.35, label: 'takes-long' },
    // Medium indicators
    { pattern: /\b(delay(ed)?|wait(ing)?)\b/i, weight: 0.25, label: 'delay' },
    { pattern: /\b(hang(s|ing)?|freeze(s|ing)?)\b/i, weight: 0.25, label: 'hang' },
    { pattern: /\bloading\b/i, weight: 0.2, label: 'loading' },
    { pattern: /\b(responsive(ness)?|speed)\b/i, weight: 0.25, label: 'responsive' },
    // Weak indicators
    { pattern: /\b(fast|faster|quick(er)?)\b/i, weight: 0.15, label: 'fast' },
    { pattern: /\b(memory|cpu|resource)\b/i, weight: 0.2, label: 'resource' },
  ],

  question: [
    // Strong indicators (questions with question marks)
    { pattern: /\b(why|how|what|when|where|which)\b.*\?/i, weight: 0.45, label: 'question-word' },
    { pattern: /\b(is there|are there|can I|do I|does it)\b.*\?/i, weight: 0.4, label: 'is-there' },
    { pattern: /\b(wondering|curious)\b/i, weight: 0.35, label: 'wondering' },
    // Medium indicators
    { pattern: /\bquestion\b/i, weight: 0.3, label: 'question' },
    { pattern: /\bhow (do|does|can|to)\b/i, weight: 0.25, label: 'how-do' },
    { pattern: /\bwhat (is|are|does)\b/i, weight: 0.25, label: 'what-is' },
    // Weak indicators
    { pattern: /\bhelp\b/i, weight: 0.15, label: 'help' },
    { pattern: /\bexplain\b/i, weight: 0.2, label: 'explain' },
  ],

  general: [],
};

/**
 * Severity patterns - determine urgency/impact
 */
const SEVERITY_PATTERNS: Record<FeedbackSeverity, PatternMatch[]> = {
  critical: [
    { pattern: /\b(crash(ed|es|ing)?|data loss|security|critical)\b/i, weight: 0.5, label: 'critical-keyword' },
    { pattern: /\bcan'?t use (at all|anything)\b/i, weight: 0.45, label: 'cant-use' },
    { pattern: /\bcompletely (broken|unusable)\b/i, weight: 0.45, label: 'completely-broken' },
    { pattern: /\burgent(ly)?\b/i, weight: 0.4, label: 'urgent' },
    { pattern: /\bemergency\b/i, weight: 0.45, label: 'emergency' },
    { pattern: /\blost (all|my|the) (data|work|files)\b/i, weight: 0.5, label: 'lost-data' },
  ],

  high: [
    { pattern: /\bbroken\b/i, weight: 0.35, label: 'broken' },
    { pattern: /\bdoesn'?t work\b/i, weight: 0.3, label: 'doesnt-work' },
    { pattern: /\b(major|important|significant)\b/i, weight: 0.3, label: 'major' },
    { pattern: /\bblocking\b/i, weight: 0.35, label: 'blocking' },
    { pattern: /\bserious(ly)?\b/i, weight: 0.25, label: 'serious' },
    { pattern: /\bcan'?t (do|complete|finish)\b/i, weight: 0.3, label: 'cant-do' },
  ],

  medium: [
    { pattern: /\bshould\b/i, weight: 0.2, label: 'should' },
    { pattern: /\b(annoying|frustrating)\b/i, weight: 0.25, label: 'annoying' },
    { pattern: /\bconfusing\b/i, weight: 0.2, label: 'confusing' },
    { pattern: /\bneeds (to be|improvement|work)\b/i, weight: 0.25, label: 'needs' },
    { pattern: /\bcould be better\b/i, weight: 0.2, label: 'could-be-better' },
    { pattern: /\bimprovement\b/i, weight: 0.2, label: 'improvement' },
  ],

  low: [
    { pattern: /\b(minor|small|tiny|little)\b/i, weight: 0.3, label: 'minor' },
    { pattern: /\bnice to have\b/i, weight: 0.3, label: 'nice-to-have' },
    { pattern: /\b(polish|nitpick|nit)\b/i, weight: 0.35, label: 'polish' },
    { pattern: /\btrivial\b/i, weight: 0.35, label: 'trivial' },
    { pattern: /\bwhen you get a chance\b/i, weight: 0.3, label: 'when-chance' },
    { pattern: /\bnot (urgent|important|critical)\b/i, weight: 0.3, label: 'not-urgent' },
  ],
};

/**
 * Tech/UI terms for keyword extraction
 */
const TECH_TERMS_PATTERN =
  /\b(button|form|input|field|modal|dialog|popup|menu|dropdown|select|checkbox|toggle|switch|slider|tab|card|list|table|grid|header|footer|sidebar|navigation|nav|navbar|search|filter|sort|pagination|api|endpoint|error|warning|loading|spinner|animation|transition|responsive|mobile|desktop|tablet|scroll|click|tap|hover|drag|drop|toast|notification|alert|badge|icon|avatar|image|video|audio|file|upload|download|link|url|page|screen|view|panel|section|container|wrapper|row|column|flex|layout)\b/gi;

/**
 * Common action verbs for title generation
 */
const ACTION_VERBS_PATTERN =
  /\b(click(ed|ing)?|tap(ped|ping)?|open(ed|ing)?|close(d|ing)?|save(d|ing)?|load(ed|ing)?|submit(ted|ting)?|select(ed|ing)?|choose|enter(ed|ing)?|type(d|ing)?|scroll(ed|ing)?|drag(ged|ging)?|drop(ped|ping)?|upload(ed|ing)?|download(ed|ing)?|delete(d|ing)?|remove(d|ing)?|add(ed|ing)?|create(d|ing)?|edit(ed|ing)?|update(d|ing)?|refresh(ed|ing)?|search(ed|ing)?|filter(ed|ing)?|sort(ed|ing)?)\b/gi;

// =============================================================================
// FeedbackAnalyzer Implementation
// =============================================================================

class FeedbackAnalyzerImpl {
  private readonly CONFIDENCE_THRESHOLD = 0.25;
  private readonly DEFAULT_CONFIDENCE = 0.5;

  /**
   * Analyze transcribed feedback text
   */
  analyze(transcription: string): AnalysisResult {
    const startTime = performance.now();

    // Normalize text
    const normalizedText = this.normalizeText(transcription);

    // 1. Category detection
    const categoryScores = this.scoreCategoriesRuleBased(normalizedText);
    const topCategory = this.selectTopCategory(categoryScores);

    // 2. Severity detection
    const severityScores = this.scoreSeverityRuleBased(normalizedText);
    const topSeverity = this.selectTopSeverity(severityScores, topCategory.category);

    // 3. Keyword extraction
    const keywords = this.extractKeywords(normalizedText);

    // 4. Title generation
    const suggestedTitle = this.generateTitle(normalizedText, topCategory.category);

    // Collect all matched patterns for debugging/transparency
    const allMatches = [
      ...topCategory.matches,
      ...topSeverity.matches,
    ];

    const processingTimeMs = performance.now() - startTime;

    return {
      category: topCategory.category,
      categoryConfidence: topCategory.score,
      severity: topSeverity.severity,
      severityConfidence: topSeverity.score,
      keywords,
      suggestedTitle,
      matchedPatterns: allMatches,
      processingTimeMs,
    };
  }

  /**
   * Batch analyze multiple transcriptions
   */
  analyzeBatch(transcriptions: string[]): AnalysisResult[] {
    return transcriptions.map((t) => this.analyze(t));
  }

  /**
   * Normalize text for consistent pattern matching
   */
  private normalizeText(text: string): string {
    return text
      .trim()
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[""]/g, '"') // Normalize quotes
      .replace(/['']/g, "'"); // Normalize apostrophes
  }

  /**
   * Score all categories using pattern matching
   */
  private scoreCategoriesRuleBased(text: string): CategoryScore[] {
    const scores: CategoryScore[] = [];

    for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
      let totalScore = 0;
      const matches: string[] = [];

      for (const { pattern, weight, label } of patterns) {
        if (pattern.test(text)) {
          totalScore += weight;
          matches.push(label);
        }
      }

      // Cap at 1.0
      const normalizedScore = Math.min(totalScore, 1.0);

      scores.push({
        category: category as FeedbackCategory,
        score: normalizedScore,
        matches,
      });
    }

    // Sort by score descending
    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * Select the best category from scores
   */
  private selectTopCategory(scores: CategoryScore[]): CategoryScore {
    const best = scores[0];

    // If best score is below threshold, default to general
    if (!best || best.score < this.CONFIDENCE_THRESHOLD) {
      return {
        category: 'general',
        score: this.DEFAULT_CONFIDENCE,
        matches: [],
      };
    }

    // Boost confidence if there's a clear winner
    const secondBest = scores[1];
    if (secondBest && best.score - secondBest.score > 0.2) {
      // Clear winner - boost confidence
      return {
        ...best,
        score: Math.min(best.score * 1.2, 1.0),
      };
    }

    return best;
  }

  /**
   * Score all severity levels using pattern matching
   */
  private scoreSeverityRuleBased(text: string): SeverityScore[] {
    const scores: SeverityScore[] = [];

    for (const [severity, patterns] of Object.entries(SEVERITY_PATTERNS)) {
      let totalScore = 0;
      const matches: string[] = [];

      for (const { pattern, weight, label } of patterns) {
        if (pattern.test(text)) {
          totalScore += weight;
          matches.push(label);
        }
      }

      // Cap at 1.0
      const normalizedScore = Math.min(totalScore, 1.0);

      scores.push({
        severity: severity as FeedbackSeverity,
        score: normalizedScore,
        matches,
      });
    }

    // Sort by score descending
    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * Select the best severity, with category-aware defaults
   */
  private selectTopSeverity(
    scores: SeverityScore[],
    category: FeedbackCategory
  ): SeverityScore {
    const best = scores[0];

    // If best score is below threshold, use category-aware defaults
    if (!best || best.score < this.CONFIDENCE_THRESHOLD) {
      const defaultSeverity = this.getDefaultSeverity(category);
      return {
        severity: defaultSeverity,
        score: this.DEFAULT_CONFIDENCE,
        matches: [],
      };
    }

    return best;
  }

  /**
   * Get default severity based on category
   */
  private getDefaultSeverity(category: FeedbackCategory): FeedbackSeverity {
    switch (category) {
      case 'bug':
        return 'high'; // Bugs default to high
      case 'performance':
        return 'medium'; // Performance issues are medium
      case 'ux-issue':
        return 'medium'; // UX issues are medium
      case 'suggestion':
        return 'low'; // Suggestions are low
      case 'question':
        return 'low'; // Questions are low
      case 'general':
      default:
        return 'medium'; // Default to medium
    }
  }

  /**
   * Extract relevant keywords from text
   */
  private extractKeywords(text: string): string[] {
    const keywords = new Set<string>();

    // Extract tech/UI terms
    const techMatches = text.match(TECH_TERMS_PATTERN) || [];
    for (const match of techMatches) {
      keywords.add(match.toLowerCase());
    }

    // Extract action verbs (useful context)
    const actionMatches = text.match(ACTION_VERBS_PATTERN) || [];
    for (const match of actionMatches) {
      // Normalize verb forms to base form
      const normalized = match.toLowerCase().replace(/(ed|ing|ped|ted|ged)$/, '');
      keywords.add(normalized);
    }

    // Limit to 8 keywords, prioritizing tech terms
    const keywordArray = Array.from(keywords);
    return keywordArray.slice(0, 8);
  }

  /**
   * Generate a suggested title from the transcription
   */
  private generateTitle(text: string, category: FeedbackCategory): string {
    // Category-specific prefixes
    const prefixes: Record<FeedbackCategory, string> = {
      bug: 'Fix:',
      'ux-issue': 'Improve:',
      suggestion: 'Add:',
      performance: 'Optimize:',
      question: 'Clarify:',
      general: '',
    };

    // Extract key phrase
    const keyPhrase = this.extractKeyPhrase(text);

    // Build title
    const prefix = prefixes[category];
    const maxLength = prefix ? 55 : 60; // Account for prefix length

    let title = keyPhrase;
    if (title.length > maxLength) {
      // Truncate at word boundary
      title = this.truncateAtWordBoundary(title, maxLength);
    }

    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);

    return prefix ? `${prefix} ${title}` : title;
  }

  /**
   * Extract the most meaningful phrase from text
   */
  private extractKeyPhrase(text: string): string {
    // Try to get the first sentence
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);

    if (sentences.length === 0) {
      return text.trim() || 'Untitled feedback';
    }

    let firstSentence = sentences[0].trim();

    // Remove common filler words from the beginning (apply repeatedly)
    const fillerPatterns = [
      /^(so|well|um|uh|like|okay|ok|alright|anyway)\s+/i,
      /^basically\s+/i,
      /^(I think|I feel|I believe|I noticed|I found)\s+(that\s+)?/i,
      /^(it seems|it looks|it appears)\s+(like|that)?\s*/i,
    ];

    let changed = true;
    while (changed) {
      changed = false;
      for (const pattern of fillerPatterns) {
        const before = firstSentence;
        firstSentence = firstSentence.replace(pattern, '');
        if (firstSentence !== before) {
          changed = true;
        }
      }
    }

    return firstSentence.trim() || text.trim().slice(0, 60);
  }

  /**
   * Truncate text at a word boundary
   */
  private truncateAtWordBoundary(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    // Find last space before maxLength
    const truncated = text.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastSpace > maxLength * 0.5) {
      return truncated.slice(0, lastSpace) + '...';
    }

    return truncated + '...';
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const feedbackAnalyzer = new FeedbackAnalyzerImpl();
export type { FeedbackAnalyzerImpl as FeedbackAnalyzer };
export default feedbackAnalyzer;
