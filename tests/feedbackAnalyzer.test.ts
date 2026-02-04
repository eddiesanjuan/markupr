/**
 * Tests for FeedbackAnalyzer
 */
import { describe, it, expect } from 'vitest';
import { feedbackAnalyzer, type AnalysisResult } from '../src/main/analysis/FeedbackAnalyzer';

describe('FeedbackAnalyzer', () => {
  describe('Category Detection', () => {
    it('should detect bug reports', () => {
      const testCases = [
        "The save button is broken, it doesn't work at all",
        'I found a bug in the export feature',
        'The app crashes when I click submit',
        "This feature doesn't work correctly",
        'Error when trying to upload a file',
      ];

      for (const text of testCases) {
        const result = feedbackAnalyzer.analyze(text);
        expect(result.category).toBe('bug');
        expect(result.categoryConfidence).toBeGreaterThan(0.25);
      }
    });

    it('should detect UX issues', () => {
      const testCases = [
        'This menu is really confusing to navigate',
        "I can't find where the settings are",
        'The interface is not intuitive at all',
        'This is hard to use on mobile',
        "It's unclear what this button does",
      ];

      for (const text of testCases) {
        const result = feedbackAnalyzer.analyze(text);
        expect(result.category).toBe('ux-issue');
        expect(result.categoryConfidence).toBeGreaterThan(0.25);
      }
    });

    it('should detect suggestions', () => {
      const testCases = [
        'It would be nice to have dark mode',
        'You should add a search feature',
        'I suggest adding keyboard shortcuts',
        'Could you add the ability to export to PDF?',
        'What if there was a way to undo changes?',
      ];

      for (const text of testCases) {
        const result = feedbackAnalyzer.analyze(text);
        expect(result.category).toBe('suggestion');
        expect(result.categoryConfidence).toBeGreaterThan(0.25);
      }
    });

    it('should detect performance issues', () => {
      const testCases = [
        'The app is really slow when loading data',
        'There is noticeable lag when scrolling',
        'Page takes forever to load',
        'The performance is terrible on large files',
        'Everything freezes when I filter the results',
      ];

      for (const text of testCases) {
        const result = feedbackAnalyzer.analyze(text);
        expect(result.category).toBe('performance');
        expect(result.categoryConfidence).toBeGreaterThan(0.25);
      }
    });

    it('should detect questions', () => {
      const testCases = [
        'How do I export my data?',
        'Why does this happen when I click here?',
        'Is there a way to customize the colors?',
        "I'm wondering if there's a keyboard shortcut for this",
        "What's the difference between save and publish?",
      ];

      for (const text of testCases) {
        const result = feedbackAnalyzer.analyze(text);
        expect(result.category).toBe('question');
        expect(result.categoryConfidence).toBeGreaterThan(0.25);
      }
    });

    it('should default to general for ambiguous feedback', () => {
      const testCases = [
        'I like this app',
        'Good job on the design',
        'Thanks for the update',
      ];

      for (const text of testCases) {
        const result = feedbackAnalyzer.analyze(text);
        expect(result.category).toBe('general');
      }
    });
  });

  describe('Severity Detection', () => {
    it('should detect critical severity', () => {
      const testCases = [
        'The app crashed and I lost all my data',
        'Critical security vulnerability found',
        "I can't use the app at all, it's completely broken",
        'Urgent: need this fixed immediately',
      ];

      for (const text of testCases) {
        const result = feedbackAnalyzer.analyze(text);
        expect(result.severity).toBe('critical');
        expect(result.severityConfidence).toBeGreaterThan(0.3);
      }
    });

    it('should detect high severity', () => {
      const testCases = [
        "The export feature is broken, I can't do my work",
        "This is a major issue that's blocking me",
        "The form doesn't work and I can't submit",
      ];

      for (const text of testCases) {
        const result = feedbackAnalyzer.analyze(text);
        expect(['critical', 'high']).toContain(result.severity);
      }
    });

    it('should detect medium severity', () => {
      const testCases = [
        'This could be better, the layout needs improvement',
        "It's annoying that I have to click twice",
        'The feature is confusing and needs work',
      ];

      for (const text of testCases) {
        const result = feedbackAnalyzer.analyze(text);
        expect(['high', 'medium']).toContain(result.severity);
      }
    });

    it('should detect low severity', () => {
      const testCases = [
        'Minor nitpick: the spacing looks a bit off',
        'This is a small polish thing, not urgent',
        'Nice to have: when you get a chance, add tooltips',
        "It's trivial but the icon could be bigger",
      ];

      for (const text of testCases) {
        const result = feedbackAnalyzer.analyze(text);
        expect(result.severity).toBe('low');
        expect(result.severityConfidence).toBeGreaterThan(0.25);
      }
    });
  });

  describe('Keyword Extraction', () => {
    it('should extract UI component keywords', () => {
      const result = feedbackAnalyzer.analyze(
        'The button in the modal dialog is not working when I click it'
      );

      expect(result.keywords).toContain('button');
      expect(result.keywords).toContain('modal');
      expect(result.keywords).toContain('dialog');
    });

    it('should extract action keywords', () => {
      const result = feedbackAnalyzer.analyze(
        'When I try to upload a file and then save it, the page freezes'
      );

      expect(result.keywords).toContain('upload');
      expect(result.keywords).toContain('file');
    });

    it('should limit keywords to 8', () => {
      const result = feedbackAnalyzer.analyze(
        'The button form input field modal dialog popup menu dropdown select checkbox toggle switch slider tab card list table grid header footer sidebar navigation search filter sort pagination'
      );

      expect(result.keywords.length).toBeLessThanOrEqual(8);
    });
  });

  describe('Title Generation', () => {
    it('should generate titles with category-appropriate prefixes', () => {
      const bugResult = feedbackAnalyzer.analyze(
        'The save button crashes the app'
      );
      expect(bugResult.suggestedTitle).toMatch(/^Fix:/);

      const suggestionResult = feedbackAnalyzer.analyze(
        'It would be great to have dark mode'
      );
      expect(suggestionResult.suggestedTitle).toMatch(/^Add:/);

      const perfResult = feedbackAnalyzer.analyze(
        'The app is really slow when loading'
      );
      expect(perfResult.suggestedTitle).toMatch(/^Optimize:/);
    });

    it('should truncate long titles', () => {
      const result = feedbackAnalyzer.analyze(
        'This is a very long feedback message that goes on and on about various issues with the application including performance problems, user interface confusion, and several bugs that I have encountered while using the software over the past few weeks'
      );

      expect(result.suggestedTitle.length).toBeLessThanOrEqual(70);
    });

    it('should remove filler words from beginning', () => {
      const result = feedbackAnalyzer.analyze(
        'So basically I think that the button should be bigger'
      );

      expect(result.suggestedTitle.toLowerCase()).not.toMatch(/^(add:|improve:)?\s*(so|basically|i think)/);
    });
  });

  describe('Batch Analysis', () => {
    it('should analyze multiple transcriptions', () => {
      const transcriptions = [
        "The app crashed when I clicked save",
        "It would be nice to have a dark mode option",
        "How do I export my data?",
      ];

      const results = feedbackAnalyzer.analyzeBatch(transcriptions);

      expect(results).toHaveLength(3);
      expect(results[0].category).toBe('bug');
      expect(results[1].category).toBe('suggestion');
      expect(results[2].category).toBe('question');
    });
  });

  describe('Confidence Scores', () => {
    it('should have higher confidence for clear signals', () => {
      const clearBug = feedbackAnalyzer.analyze('Bug: the app crashes when clicking the button and is completely broken');
      const weakBug = feedbackAnalyzer.analyze('There might be an issue with this');

      // Clear signals should have high confidence
      expect(clearBug.categoryConfidence).toBeGreaterThan(0.5);
      // Weak signals should have lower confidence
      expect(weakBug.categoryConfidence).toBeLessThan(clearBug.categoryConfidence);
    });

    it('should have confidence between 0 and 1', () => {
      const result = feedbackAnalyzer.analyze('This is a test feedback message');

      expect(result.categoryConfidence).toBeGreaterThanOrEqual(0);
      expect(result.categoryConfidence).toBeLessThanOrEqual(1);
      expect(result.severityConfidence).toBeGreaterThanOrEqual(0);
      expect(result.severityConfidence).toBeLessThanOrEqual(1);
    });
  });

  describe('Processing Time', () => {
    it('should process quickly (under 10ms)', () => {
      const result = feedbackAnalyzer.analyze(
        'The save button crashes the app when I click it multiple times'
      );

      expect(result.processingTimeMs).toBeLessThan(10);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      const result = feedbackAnalyzer.analyze('');

      expect(result.category).toBe('general');
      expect(result.suggestedTitle).toBe('Untitled feedback');
    });

    it('should handle whitespace-only string', () => {
      const result = feedbackAnalyzer.analyze('   \n\t  ');

      expect(result.category).toBe('general');
    });

    it('should handle special characters', () => {
      const result = feedbackAnalyzer.analyze(
        "The button's behavior doesn't match what I'd expect and is broken!!!"
      );

      expect(result.category).toBe('bug');
    });

    it('should handle unicode text', () => {
      const result = feedbackAnalyzer.analyze(
        'The button is broken'
      );

      expect(result.category).toBe('bug');
    });
  });
});
