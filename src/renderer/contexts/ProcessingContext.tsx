/**
 * ProcessingContext
 *
 * Manages the post-processing progress display: smoothing raw progress events
 * into a believable, continuous progress bar animation. Consumes raw progress
 * data from RecordingContext and provides smoothed display values.
 *
 * Uses useAnimatedValue from hooks/useAnimation.tsx for smooth interpolation
 * instead of a custom Bezier implementation.
 */

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAnimatedValue } from '../hooks/useAnimation';
import { useRecording } from './RecordingContext';

// ============================================================================
// Constants
// ============================================================================

export const PROCESSING_BASELINE_PERCENT = 4;
export const PROCESSING_VISIBLE_MAX = 96;
const PROCESSING_TARGET_TICK_MS = 120;

export const PROCESSING_DOT_FRAMES = ['∙∙∙', '●∙∙', '●●∙', '●●●'] as const;

const PROCESSING_STEP_LABELS: Record<string, string> = {
  preparing: 'Finalizing recording assets...',
  transcribing: 'Transcribing narration...',
  analyzing: 'Analyzing spoken context...',
  saving: 'Saving session artifacts...',
  'extracting-frames': 'Extracting key visual frames...',
  'generating-report': 'Generating markdown report...',
  complete: 'Finalizing output files...',
};

const PROCESSING_STEP_TARGETS: Record<string, number> = {
  preparing: 28,
  transcribing: 58,
  analyzing: 72,
  saving: 82,
  'extracting-frames': 90,
  'generating-report': PROCESSING_VISIBLE_MAX,
  complete: PROCESSING_VISIBLE_MAX,
};

// ============================================================================
// Helpers
// ============================================================================

function normalizeProcessingStep(step?: string): string {
  if (!step) return 'preparing';
  return step.toLowerCase();
}

export function formatProcessingStep(step?: string): string {
  const normalized = normalizeProcessingStep(step);
  return PROCESSING_STEP_LABELS[normalized] || 'Finalizing report output...';
}

function resolveProcessingStageTarget(step?: string): number {
  const normalized = normalizeProcessingStep(step);
  return PROCESSING_STEP_TARGETS[normalized] ?? 88;
}

// ============================================================================
// Types
// ============================================================================

interface ProcessingProgress {
  percent: number;
  step: string;
}

export interface ProcessingContextValue {
  /** Smoothed processing progress for display */
  processingProgress: ProcessingProgress | null;
  /** Current dot-animation frame index */
  processingDotFrame: number;
  /** Whether the app is in a processing state */
  isProcessing: boolean;
}

const ProcessingContext = createContext<ProcessingContextValue | null>(null);

export function useProcessing(): ProcessingContextValue {
  const context = useContext(ProcessingContext);
  if (!context) {
    throw new Error('useProcessing must be used within ProcessingProvider');
  }
  return context;
}

// ============================================================================
// Provider
// ============================================================================

export const ProcessingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { state, rawProcessingProgress, processingStartedAt } = useRecording();

  const isProcessing = state === 'stopping' || state === 'processing';

  // Track the target percent that we want to animate toward
  const [targetPercent, setTargetPercent] = useState(PROCESSING_BASELINE_PERCENT);
  const [stepLabel, setStepLabel] = useState<string>('');
  const [processingDotFrame, setProcessingDotFrame] = useState(0);

  // Ref to track the processing start time (local copy since ref from recording
  // context value is a snapshot)
  const processingStartRef = useRef<number | null>(null);

  // Sync the processing start time
  useEffect(() => {
    if (isProcessing && !processingStartRef.current) {
      processingStartRef.current = processingStartedAt ?? Date.now();
    }
    if (!isProcessing) {
      processingStartRef.current = null;
    }
  }, [isProcessing, processingStartedAt]);

  // Compute target percent periodically (same interval as original)
  useEffect(() => {
    if (!isProcessing) {
      setTargetPercent(PROCESSING_BASELINE_PERCENT);
      return;
    }

    const interval = window.setInterval(() => {
      const startedAt = processingStartRef.current ?? Date.now();
      const elapsedMs = Date.now() - startedAt;

      // Time-based floor (asymptotic curve ensuring progress even without events)
      const elapsedFloor = (() => {
        if (elapsedMs < 2200) {
          return PROCESSING_BASELINE_PERCENT + elapsedMs / 120;
        }
        if (elapsedMs < 9000) {
          return 22 + (elapsedMs - 2200) / 170;
        }
        if (elapsedMs < 22000) {
          return 62 + (elapsedMs - 9000) / 420;
        }
        return 85 + (elapsedMs - 22000) / 1300;
      })();

      // Raw progress guided value
      const rawPercent = Math.max(0, Math.min(100, rawProcessingProgress?.percent ?? 0));
      const rawGuided = Math.min(PROCESSING_VISIBLE_MAX, rawPercent + 8);

      // Stage target based on current step
      const stageTarget = resolveProcessingStageTarget(rawProcessingProgress?.step);

      // Final target: max of all three signals, clamped
      const nextTarget = Math.max(
        PROCESSING_BASELINE_PERCENT,
        Math.min(PROCESSING_VISIBLE_MAX, Math.max(elapsedFloor, rawGuided, stageTarget))
      );

      setTargetPercent(nextTarget);
      setStepLabel(formatProcessingStep(rawProcessingProgress?.step));
    }, PROCESSING_TARGET_TICK_MS);

    return () => window.clearInterval(interval);
  }, [isProcessing, rawProcessingProgress]);

  // Handle the 100% completion case (bypass animation, snap to 100)
  const isComplete = rawProcessingProgress?.percent === 100;

  useEffect(() => {
    if (isComplete) {
      setTargetPercent(100);
      setStepLabel(formatProcessingStep('complete'));
    }
  }, [isComplete]);

  // Smooth the percent using useAnimatedValue
  const smoothedPercent = useAnimatedValue(
    isProcessing || isComplete ? targetPercent : PROCESSING_BASELINE_PERCENT,
    { duration: 280 }
  );

  // Dot frame animation
  useEffect(() => {
    if (!isProcessing) {
      setProcessingDotFrame(0);
      return;
    }

    const interval = window.setInterval(() => {
      setProcessingDotFrame((prev) => (prev + 1) % 4);
    }, 360);

    return () => window.clearInterval(interval);
  }, [isProcessing]);

  // Build the final progress value
  const processingProgress = useMemo((): ProcessingProgress | null => {
    if (!isProcessing && !isComplete) return null;

    // For 100% completion, return exact value without rounding noise
    if (isComplete) {
      return { percent: 100, step: formatProcessingStep('complete') };
    }

    return {
      percent: Math.round(Math.min(PROCESSING_VISIBLE_MAX, smoothedPercent)),
      step: stepLabel || formatProcessingStep('preparing'),
    };
  }, [isProcessing, isComplete, smoothedPercent, stepLabel]);

  const value = useMemo(
    (): ProcessingContextValue => ({
      processingProgress,
      processingDotFrame,
      isProcessing,
    }),
    [processingProgress, processingDotFrame, isProcessing]
  );

  return (
    <ProcessingContext.Provider value={value}>
      {children}
    </ProcessingContext.Provider>
  );
};

export default ProcessingContext;
