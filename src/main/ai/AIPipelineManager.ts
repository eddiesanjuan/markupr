/**
 * AIPipelineManager - Orchestrator for the AI analysis pipeline
 *
 * Determines which processing tier to use (free vs BYOK), generates output accordingly,
 * and ensures the free-tier safety net is always available as fallback.
 *
 * Key invariant: session data is NEVER lost. Free-tier output is always generated first,
 * and AI enhancement is layered on top only when it succeeds.
 */

import type { Session } from '../SessionController';
import type { MarkdownDocument } from '../output/FileManager';
import type { ISettingsManager } from '../settings/SettingsManager';
import { generateDocumentForFileManager } from '../output/sessionAdapter';
import { ClaudeAnalyzer } from './ClaudeAnalyzer';
import { structuredMarkdownBuilder } from './StructuredMarkdownBuilder';
import type {
  AITier,
  AIPipelineOutput,
} from './types';

export interface PipelineProcessOptions {
  settingsManager: ISettingsManager;
  projectName?: string;
  screenshotDir?: string;
  hasRecording?: boolean;
  recordingFilename?: string;
}

/**
 * Determine which AI tier is available based on stored API keys.
 */
async function determineTier(settingsManager: ISettingsManager): Promise<AITier> {
  const anthropicKey = await settingsManager.getApiKey('anthropic');
  if (anthropicKey && anthropicKey.length > 0) {
    console.log('[AIPipelineManager] Tier decision: BYOK (Anthropic API key found in keychain)');
    return 'byok';
  }
  console.log('[AIPipelineManager] Tier decision: FREE (no Anthropic API key configured)');
  return 'free';
}

/**
 * Generate a free-tier (rule-based) document. This is the safety net that always works.
 */
function generateFreeTierDocument(
  session: Session,
  projectName: string,
  screenshotDir: string,
): MarkdownDocument {
  return generateDocumentForFileManager(session, {
    projectName,
    screenshotDir,
  });
}

/**
 * Process a session through the AI pipeline.
 *
 * 1. Always generates free-tier output first (safety net)
 * 2. If BYOK tier is available, attempts AI enhancement
 * 3. On any AI failure, returns the free-tier output
 *
 * @returns A MarkdownDocument compatible with FileManager.saveSession()
 */
export async function processSession(
  session: Session,
  options: PipelineProcessOptions,
): Promise<{ document: MarkdownDocument; pipelineOutput: AIPipelineOutput }> {
  const startTime = Date.now();
  const projectName = options.projectName || session.metadata?.sourceName || 'Feedback Session';
  const screenshotDir = options.screenshotDir || './screenshots';

  // ALWAYS generate free-tier output first as safety net
  console.log('[AIPipelineManager] Generating free-tier output as safety net...');
  const freeTierDoc = generateFreeTierDocument(session, projectName, screenshotDir);
  console.log('[AIPipelineManager] Free-tier output ready (rule-based markdown generated)');

  // Determine tier
  const tier = await determineTier(options.settingsManager);

  if (tier === 'free') {
    console.log(
      `[AIPipelineManager] Using free-tier output (no AI enhancement). ` +
      `Session had ${session.feedbackItems.length} feedback items, ` +
      `${session.transcriptBuffer.length} transcript events. ` +
      `Completed in ${Date.now() - startTime}ms.`
    );
    return {
      document: freeTierDoc,
      pipelineOutput: {
        markdown: freeTierDoc.content,
        aiEnhanced: false,
        processingTimeMs: Date.now() - startTime,
        tier: 'free',
      },
    };
  }

  // BYOK tier: attempt AI enhancement
  console.log('[AIPipelineManager] BYOK tier: attempting Claude AI enhancement...');
  try {
    const apiKey = await options.settingsManager.getApiKey('anthropic');
    if (!apiKey) {
      // Shouldn't happen since determineTier checked, but be defensive
      console.warn('[AIPipelineManager] BYOK -> FREE fallback: API key disappeared between tier check and usage');
      return {
        document: freeTierDoc,
        pipelineOutput: {
          markdown: freeTierDoc.content,
          aiEnhanced: false,
          processingTimeMs: Date.now() - startTime,
          tier: 'free',
          fallbackReason: 'API key not found after tier selection',
        },
      };
    }

    console.log(
      `[AIPipelineManager] Calling Claude API (BYOK) with ` +
      `${session.feedbackItems.length} feedback items, ` +
      `${session.transcriptBuffer.length} transcript events...`
    );

    const analyzer = new ClaudeAnalyzer(apiKey);
    const analysis = await analyzer.analyze(session);

    if (!analysis) {
      console.warn(
        `[AIPipelineManager] BYOK -> FREE fallback: Claude API returned null analysis ` +
        `after ${Date.now() - startTime}ms. Using free-tier rule-based output instead.`
      );
      return {
        document: freeTierDoc,
        pipelineOutput: {
          markdown: freeTierDoc.content,
          aiEnhanced: false,
          processingTimeMs: Date.now() - startTime,
          tier: 'byok',
          fallbackReason: 'Claude analysis returned null',
        },
      };
    }

    // Build AI-enhanced markdown
    const aiMarkdown = structuredMarkdownBuilder.buildDocument(session, analysis, {
      projectName,
      screenshotDir,
      hasRecording: options.hasRecording,
      recordingFilename: options.recordingFilename,
      modelId: 'claude-sonnet-4-5-20250929',
    });

    // Build a MarkdownDocument compatible with FileManager
    const aiDocument: MarkdownDocument = {
      content: aiMarkdown,
      metadata: {
        itemCount: analysis.items.length,
        screenshotCount: session.screenshotBuffer.length,
        types: [...new Set(analysis.items.map((item) => item.category))],
      },
    };

    console.log(
      `[AIPipelineManager] AI analysis complete: ${analysis.items.length} items, ` +
      `${analysis.metadata.criticalCount} critical, ${analysis.metadata.highCount} high ` +
      `(${Date.now() - startTime}ms)`,
    );

    return {
      document: aiDocument,
      pipelineOutput: {
        markdown: aiMarkdown,
        aiEnhanced: true,
        analysis,
        processingTimeMs: Date.now() - startTime,
        tier: 'byok',
      },
    };
  } catch (error) {
    // ANY error in the AI path falls back to free tier - never lose the session
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[AIPipelineManager] BYOK -> FREE fallback: AI pipeline threw after ${Date.now() - startTime}ms. ` +
      `Error: ${errorMessage}. Using free-tier rule-based output instead.`
    );

    return {
      document: freeTierDoc,
      pipelineOutput: {
        markdown: freeTierDoc.content,
        aiEnhanced: false,
        processingTimeMs: Date.now() - startTime,
        tier: 'byok',
        fallbackReason: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}
