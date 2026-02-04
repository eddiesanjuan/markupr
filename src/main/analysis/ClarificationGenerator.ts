/**
 * ClarificationGenerator - Smart Question Generation for Ambiguous Feedback
 *
 * Detects vague or unclear feedback and generates targeted clarification questions
 * to help users provide more actionable context.
 *
 * Detection patterns:
 * - Pronouns without clear antecedent: "this", "that", "it"
 * - Vague locations: "here", "there", "somewhere"
 * - Unclear references: "the button", "the form" without specifics
 * - Time references: "sometimes", "occasionally", "usually"
 * - Vague comparisons: "too slow", "very small"
 *
 * Questions are skippable and answers are appended to feedback items.
 */

import type { FeedbackItem } from '../output/MarkdownGenerator';

// =============================================================================
// Types
// =============================================================================

/**
 * Type of clarification needed
 */
export type ClarificationType =
  | 'location'
  | 'reproduction'
  | 'expectation'
  | 'frequency'
  | 'reference'
  | 'comparison';

/**
 * A single clarification question
 */
export interface ClarificationQuestion {
  id: string;
  feedbackItemId: string;
  question: string;
  type: ClarificationType;
  placeholder: string;
  /** Optional: the matched text that triggered this question */
  matchedText?: string;
}

/**
 * Answer to a clarification question
 */
export interface ClarificationAnswer {
  questionId: string;
  feedbackItemId: string;
  answer: string;
}

/**
 * Result of applying clarification answers to feedback
 */
export interface ClarifiedFeedback {
  feedbackItems: FeedbackItem[];
  clarifications: ClarificationAnswer[];
}

// =============================================================================
// Pattern Definitions
// =============================================================================

interface AmbiguityPattern {
  pattern: RegExp;
  type: ClarificationType;
  question: string;
  placeholder: string;
  /** Weight for prioritization (higher = more likely to ask) */
  weight: number;
}

/**
 * Patterns for detecting ambiguity in feedback text
 *
 * Note: Patterns use negative lookahead to avoid false positives where
 * the meaning is actually clear (e.g., "it doesn't work" is clear enough)
 */
const AMBIGUITY_PATTERNS: AmbiguityPattern[] = [
  // Vague pronouns (when not part of common clear phrases)
  {
    pattern: /\b(this|that)\b(?!\s+(is|was|should|could|would|doesn't|does not|isn't|is not)\s)/gi,
    type: 'reference',
    question: 'What specifically are you referring to?',
    placeholder: 'e.g., "the save button in the header"',
    weight: 0.8,
  },
  {
    pattern: /\bit\b(?!\s+(is|was|should|could|would|doesn't|does not|works|worked))/gi,
    type: 'reference',
    question: 'What specifically does "it" refer to?',
    placeholder: 'e.g., "the file upload component"',
    weight: 0.6,
  },

  // Vague locations
  {
    pattern: /\b(here|there)\b(?!\s+(is|are|was|were)\s+(no|nothing|a|an|the))/gi,
    type: 'location',
    question: 'Where exactly in the interface?',
    placeholder: 'e.g., "top right corner of the settings page"',
    weight: 0.85,
  },
  {
    pattern: /\bsomewhere\b/gi,
    type: 'location',
    question: 'Can you describe where more specifically?',
    placeholder: 'e.g., "in the navigation menu, maybe under settings"',
    weight: 0.9,
  },

  // Unclear element references (without labels/names)
  {
    pattern: /\bthe\s+(button|link)\b(?!\s+(labeled|called|named|titled|that says|with|for))/gi,
    type: 'reference',
    question: 'Which button/link specifically?',
    placeholder: 'e.g., "the blue Submit button at the bottom of the form"',
    weight: 0.75,
  },
  {
    pattern: /\bthe\s+(form|field|input)\b(?!\s+(labeled|called|named|titled|for|where))/gi,
    type: 'reference',
    question: 'Which form/field specifically?',
    placeholder: 'e.g., "the email input field in the signup form"',
    weight: 0.75,
  },
  {
    pattern: /\bthe\s+(menu|dropdown|select)\b(?!\s+(labeled|called|named|titled|for|with))/gi,
    type: 'reference',
    question: 'Which menu/dropdown specifically?',
    placeholder: 'e.g., "the file type dropdown in the export dialog"',
    weight: 0.75,
  },
  {
    pattern: /\bthe\s+(modal|dialog|popup|panel)\b(?!\s+(labeled|called|named|titled|that))/gi,
    type: 'reference',
    question: 'Which modal/dialog specifically?',
    placeholder: 'e.g., "the confirmation dialog after clicking delete"',
    weight: 0.75,
  },
  {
    pattern: /\bthe\s+(page|screen|section)\b(?!\s+(labeled|called|named|titled|where|for))/gi,
    type: 'location',
    question: 'Which page/screen specifically?',
    placeholder: 'e.g., "the user profile settings page"',
    weight: 0.7,
  },

  // Intermittent issues (frequency unclear)
  {
    pattern: /\b(sometimes|occasionally|usually|often|rarely|every now and then)\b/gi,
    type: 'frequency',
    question: 'How often does this happen?',
    placeholder: 'e.g., "about 1 in 3 times when saving" or "only on first load"',
    weight: 0.9,
  },
  {
    pattern: /\b(intermittent(ly)?|sporadic(ally)?|random(ly)?)\b/gi,
    type: 'frequency',
    question: 'Can you estimate how frequently this occurs?',
    placeholder: 'e.g., "maybe 20% of the time" or "after about 5 minutes of use"',
    weight: 0.85,
  },

  // Vague comparisons
  {
    pattern: /\b(too|very|quite|rather|extremely)\s+(slow|fast|big|small|large|tiny|long|short)\b/gi,
    type: 'comparison',
    question: 'Can you be more specific about the expected behavior?',
    placeholder: 'e.g., "should load in under 2 seconds" or "should be at least 200px wide"',
    weight: 0.7,
  },
  {
    pattern: /\btakes\s+(forever|too long|a while|ages)\b/gi,
    type: 'comparison',
    question: 'How long does it actually take, and how long should it take?',
    placeholder: 'e.g., "takes 10 seconds but should be instant"',
    weight: 0.8,
  },
];

/**
 * Questions for specific feedback categories (asked when no patterns match)
 */
const CATEGORY_QUESTIONS: Record<string, { question: string; placeholder: string; type: ClarificationType }> = {
  bug: {
    question: 'What steps led to this issue?',
    type: 'reproduction',
    placeholder: 'e.g., "After clicking submit, then going back..."',
  },
  'ux-issue': {
    question: 'What would be a better experience?',
    type: 'expectation',
    placeholder: 'e.g., "I expected to see a confirmation before deleting"',
  },
  suggestion: {
    question: 'How should it work ideally?',
    type: 'expectation',
    placeholder: 'e.g., "It should save automatically when I switch tabs"',
  },
};

// =============================================================================
// ClarificationGenerator Implementation
// =============================================================================

class ClarificationGeneratorImpl {
  private readonly MAX_QUESTIONS = 5;

  /**
   * Generate clarification questions for a list of feedback items.
   *
   * Returns at most MAX_QUESTIONS to avoid overwhelming the user.
   * Questions are prioritized by pattern weight and relevance.
   */
  generate(feedbackItems: FeedbackItem[]): ClarificationQuestion[] {
    const allQuestions: Array<ClarificationQuestion & { weight: number }> = [];

    for (const item of feedbackItems) {
      const text = item.transcription;
      const itemId = item.id;

      // Track which question types we've already added for this item
      const addedTypes = new Set<ClarificationType>();

      // Check each ambiguity pattern
      for (const patternDef of AMBIGUITY_PATTERNS) {
        // Reset lastIndex for global patterns
        patternDef.pattern.lastIndex = 0;

        const match = patternDef.pattern.exec(text);
        if (match && !addedTypes.has(patternDef.type)) {
          addedTypes.add(patternDef.type);

          allQuestions.push({
            id: `${itemId}-${patternDef.type}`,
            feedbackItemId: itemId,
            question: patternDef.question,
            type: patternDef.type,
            placeholder: patternDef.placeholder,
            matchedText: match[0],
            weight: patternDef.weight,
          });
        }
      }

      // Check for category-specific questions
      const category = item.category?.toLowerCase().replace(' ', '-');
      if (category && CATEGORY_QUESTIONS[category]) {
        const categoryQ = CATEGORY_QUESTIONS[category];

        // Only add if we don't have a similar type question already
        if (!addedTypes.has(categoryQ.type)) {
          // Check if the text already provides the information
          const hasReproSteps = /\b(when|after|before|then|first|next|if)\b/i.test(text);
          const hasExpectation = /\b(should|expect|instead|ideally|rather|better)\b/i.test(text);

          const shouldSkip =
            (categoryQ.type === 'reproduction' && hasReproSteps) ||
            (categoryQ.type === 'expectation' && hasExpectation);

          if (!shouldSkip) {
            allQuestions.push({
              id: `${itemId}-category-${categoryQ.type}`,
              feedbackItemId: itemId,
              question: categoryQ.question,
              type: categoryQ.type,
              placeholder: categoryQ.placeholder,
              weight: 0.5, // Lower weight for category questions
            });
          }
        }
      }
    }

    // Sort by weight (higher first) and limit
    const sortedQuestions = allQuestions
      .sort((a, b) => b.weight - a.weight)
      .slice(0, this.MAX_QUESTIONS);

    // Remove the weight property before returning
    return sortedQuestions.map(({ weight: _weight, ...q }) => q);
  }

  /**
   * Apply clarification answers to feedback items.
   *
   * Answers are appended to the transcription in a structured format:
   * [Original text]
   *
   * **Clarification:**
   * - Question: Answer
   */
  applyClarifications(
    feedbackItems: FeedbackItem[],
    answers: Record<string, string>
  ): ClarifiedFeedback {
    const clarifications: ClarificationAnswer[] = [];

    const updatedItems = feedbackItems.map((item) => {
      // Find all answers for this item
      const itemAnswers: { question: string; answer: string }[] = [];

      for (const [questionId, answer] of Object.entries(answers)) {
        // Skip empty answers
        if (!answer.trim()) continue;

        // Check if this question belongs to this item
        if (questionId.startsWith(item.id)) {
          // Extract the question from the ID to find the original question text
          const questionType = questionId.replace(`${item.id}-`, '').replace('category-', '');

          // Find the matching pattern or category question
          const patternQ = AMBIGUITY_PATTERNS.find((p) => p.type === questionType);
          const categoryQ = Object.values(CATEGORY_QUESTIONS).find((q) => q.type === questionType);

          const questionText = patternQ?.question || categoryQ?.question || 'Additional context';

          itemAnswers.push({ question: questionText, answer });

          clarifications.push({
            questionId,
            feedbackItemId: item.id,
            answer,
          });
        }
      }

      // If we have answers, append them to the transcription
      if (itemAnswers.length > 0) {
        const clarificationText = itemAnswers
          .map((qa) => `- ${qa.question} ${qa.answer}`)
          .join('\n');

        return {
          ...item,
          transcription: `${item.transcription}\n\n**Clarification:**\n${clarificationText}`,
        };
      }

      return item;
    });

    return {
      feedbackItems: updatedItems,
      clarifications,
    };
  }

  /**
   * Check if a feedback item would benefit from clarification.
   * Useful for showing a "needs clarification" indicator.
   */
  needsClarification(item: FeedbackItem): boolean {
    const text = item.transcription;

    for (const patternDef of AMBIGUITY_PATTERNS) {
      patternDef.pattern.lastIndex = 0;
      if (patternDef.pattern.test(text)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get the count of items that need clarification.
   */
  getClarificationCount(feedbackItems: FeedbackItem[]): number {
    return feedbackItems.filter((item) => this.needsClarification(item)).length;
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const clarificationGenerator = new ClarificationGeneratorImpl();
export type { ClarificationGeneratorImpl as ClarificationGenerator };
export default clarificationGenerator;
