/**
 * ClarificationQuestions - Smart Feedback Context Collector
 *
 * A modal interface for gathering additional context on ambiguous feedback.
 * Helps users clarify vague references, unclear locations, and missing details.
 *
 * Features:
 * - Progress indicator showing question number
 * - Skippable questions (users aren't forced to answer)
 * - Skip all option for users in a hurry
 * - Smooth animations between questions
 * - Keyboard navigation (Enter to continue, Escape to skip)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

// =============================================================================
// Types
// =============================================================================

/**
 * Type of clarification needed (mirrored from main process)
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
  matchedText?: string;
}

/**
 * Props for ClarificationQuestions component
 */
export interface ClarificationQuestionsProps {
  /** Array of questions to ask */
  questions: ClarificationQuestion[];
  /** Called when all questions are answered (or skipped) */
  onComplete: (answers: Record<string, string>) => void;
  /** Called when user skips all remaining questions */
  onSkipAll: () => void;
  /** Optional: Custom title for the modal */
  title?: string;
}

// =============================================================================
// Helper Components
// =============================================================================

/**
 * Icon component for question types
 */
const QuestionTypeIcon: React.FC<{ type: ClarificationType }> = ({ type }) => {
  const iconProps = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (type) {
    case 'location':
      return (
        <svg {...iconProps}>
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      );
    case 'reproduction':
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case 'expectation':
      return (
        <svg {...iconProps}>
          <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      );
    case 'frequency':
      return (
        <svg {...iconProps}>
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      );
    case 'reference':
      return (
        <svg {...iconProps}>
          <path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
        </svg>
      );
    case 'comparison':
      return (
        <svg {...iconProps}>
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      );
    default:
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
  }
};

/**
 * Human-readable label for question type
 */
const getTypeLabel = (type: ClarificationType): string => {
  const labels: Record<ClarificationType, string> = {
    location: 'Location',
    reproduction: 'Steps',
    expectation: 'Expected Behavior',
    frequency: 'Frequency',
    reference: 'Reference',
    comparison: 'Comparison',
  };
  return labels[type] || 'Context';
};

// =============================================================================
// Main Component
// =============================================================================

export function ClarificationQuestions({
  questions,
  onComplete,
  onSkipAll,
  title = 'Quick Clarification',
}: ClarificationQuestionsProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentQuestion = questions[currentIndex];
  const isLast = currentIndex === questions.length - 1;
  const answeredCount = Object.values(answers).filter((a) => a.trim()).length;

  // Focus textarea when question changes
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [currentIndex]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleSkip();
      } else if (e.key === 'Enter' && e.metaKey) {
        e.preventDefault();
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, isLast]);

  const handleAnswer = useCallback((answer: string) => {
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: answer }));
  }, [currentQuestion?.id]);

  const handleNext = useCallback(() => {
    if (isLast) {
      setIsExiting(true);
      setTimeout(() => {
        onComplete(answers);
      }, 200);
    } else {
      setDirection('forward');
      setCurrentIndex((i) => i + 1);
    }
  }, [isLast, answers, onComplete]);

  const handleSkip = useCallback(() => {
    if (isLast) {
      setIsExiting(true);
      setTimeout(() => {
        onComplete(answers);
      }, 200);
    } else {
      setDirection('forward');
      setCurrentIndex((i) => i + 1);
    }
  }, [isLast, answers, onComplete]);

  const handleBack = useCallback(() => {
    if (currentIndex > 0) {
      setDirection('backward');
      setCurrentIndex((i) => i - 1);
    }
  }, [currentIndex]);

  const handleSkipAll = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onSkipAll();
    }, 200);
  }, [onSkipAll]);

  // Don't render if no questions
  if (questions.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        ...styles.overlay,
        opacity: isExiting ? 0 : 1,
      }}
    >
      <div
        style={{
          ...styles.modal,
          transform: isExiting ? 'scale(0.95) translateY(10px)' : 'scale(1) translateY(0)',
        }}
      >
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <div style={styles.iconWrapper}>
              <QuestionTypeIcon type={currentQuestion.type} />
            </div>
            <div>
              <h2 style={styles.title}>{title}</h2>
              <span style={styles.typeLabel}>
                {getTypeLabel(currentQuestion.type)}
              </span>
            </div>
          </div>
          <button onClick={handleSkipAll} style={styles.skipAllButton}>
            Skip all
          </button>
        </div>

        {/* Progress */}
        <div style={styles.progressContainer}>
          <div style={styles.progressBar}>
            <div
              style={{
                ...styles.progressFill,
                width: `${((currentIndex + 1) / questions.length) * 100}%`,
              }}
            />
          </div>
          <span style={styles.progressText}>
            {currentIndex + 1} of {questions.length}
          </span>
        </div>

        {/* Question */}
        <div
          style={{
            ...styles.questionContainer,
            animation: `${direction === 'forward' ? 'pageSlideInRight' : 'pageSlideInLeft'} 0.2s ease-out`,
          }}
          key={currentQuestion.id}
        >
          <h3 style={styles.question}>{currentQuestion.question}</h3>
          <p style={styles.hint}>
            This will help provide more actionable context to your feedback.
          </p>

          {/* Matched text indicator */}
          {currentQuestion.matchedText && (
            <div style={styles.matchedText}>
              Triggered by:{' '}
              <code style={styles.matchedCode}>
                &quot;{currentQuestion.matchedText}&quot;
              </code>
            </div>
          )}
        </div>

        {/* Input */}
        <textarea
          ref={textareaRef}
          value={answers[currentQuestion.id] || ''}
          onChange={(e) => handleAnswer(e.target.value)}
          placeholder={currentQuestion.placeholder}
          style={styles.textarea}
          rows={3}
        />

        {/* Actions */}
        <div style={styles.actions}>
          <div style={styles.actionsLeft}>
            {currentIndex > 0 && (
              <button onClick={handleBack} style={styles.backButton}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Back
              </button>
            )}
          </div>

          <div style={styles.actionsRight}>
            <button onClick={handleSkip} style={styles.skipButton}>
              Skip
            </button>
            <button onClick={handleNext} style={styles.nextButton}>
              {isLast ? 'Done' : 'Next'}
              {!isLast && (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Keyboard hints */}
        <div style={styles.keyboardHints}>
          <span style={styles.keyboardHint}>
            <kbd style={styles.kbd}>Esc</kbd> Skip
          </span>
          <span style={styles.keyboardHint}>
            <kbd style={styles.kbd}>Cmd</kbd>+<kbd style={styles.kbd}>Enter</kbd> Continue
          </span>
        </div>

        {/* Answered count indicator */}
        {answeredCount > 0 && (
          <div style={styles.answeredIndicator}>
            {answeredCount} answered
          </div>
        )}
      </div>

      {/* pageSlideInRight, pageSlideInLeft, pageFadeIn, dialogEnter keyframes provided by animations.css */}
    </div>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    padding: 16,
    transition: 'opacity 0.2s ease-out',
    animation: 'pageFadeIn 0.2s ease-out',
  },

  modal: {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid rgba(51, 65, 85, 0.8)',
    borderRadius: 16,
    padding: 24,
    maxWidth: 480,
    width: '100%',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)',
    transition: 'transform 0.2s ease-out',
    animation: 'dialogEnter 0.3s ease-out',
    position: 'relative',
  },

  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 20,
  },

  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },

  iconWrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    color: 'var(--text-link)',
  },

  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text-primary)',
    lineHeight: 1.2,
  },

  typeLabel: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },

  skipAllButton: {
    padding: '6px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 6,
    color: 'var(--text-tertiary)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'color 0.15s ease',
  },

  progressContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },

  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(51, 65, 85, 0.5)',
    borderRadius: 2,
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    backgroundColor: 'var(--accent-default)',
    borderRadius: 2,
    transition: 'width 0.3s ease-out',
  },

  progressText: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },

  questionContainer: {
    marginBottom: 16,
  },

  question: {
    margin: '0 0 8px 0',
    fontSize: 16,
    fontWeight: 500,
    color: 'var(--text-primary)',
    lineHeight: 1.4,
  },

  hint: {
    margin: 0,
    fontSize: 13,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },

  matchedText: {
    marginTop: 12,
    padding: '8px 12px',
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    border: '1px solid rgba(251, 191, 36, 0.2)',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--status-warning)',
  },

  matchedCode: {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    padding: '2px 6px',
    borderRadius: 4,
  },

  textarea: {
    width: '100%',
    minHeight: 80,
    padding: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    border: '1px solid rgba(51, 65, 85, 0.8)',
    borderRadius: 10,
    color: 'var(--text-primary)',
    fontSize: 14,
    lineHeight: 1.5,
    resize: 'vertical',
    outline: 'none',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
    boxSizing: 'border-box',
  },

  actions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
  },

  actionsLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },

  actionsRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },

  backButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '8px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 8,
    color: 'var(--text-secondary)',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'color 0.15s ease',
  },

  skipButton: {
    padding: '10px 16px',
    backgroundColor: 'transparent',
    border: '1px solid rgba(51, 65, 85, 0.8)',
    borderRadius: 8,
    color: 'var(--text-secondary)',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },

  nextButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '10px 20px',
    backgroundColor: 'var(--accent-default)',
    border: 'none',
    borderRadius: 8,
    color: 'var(--text-inverse)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
  },

  keyboardHints: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 16,
    paddingTop: 16,
    borderTop: '1px solid rgba(51, 65, 85, 0.5)',
  },

  keyboardHint: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },

  kbd: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 20,
    padding: '2px 6px',
    backgroundColor: 'rgba(51, 65, 85, 0.5)',
    border: '1px solid rgba(71, 85, 105, 0.5)',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    fontFamily: 'inherit',
  },

  answeredIndicator: {
    position: 'absolute',
    bottom: -10,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '4px 12px',
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    border: '1px solid rgba(34, 197, 94, 0.3)',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--status-success)',
  },
};

// Default export for convenience
export default ClarificationQuestions;
