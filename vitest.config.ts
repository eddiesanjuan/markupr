import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        '**/*.d.ts',
        '**/types.ts',
        '**/*.config.ts',
        '**/index.ts', // Re-exports
      ],
      // Coverage thresholds (aspirational - can be adjusted)
      // thresholds: {
      //   lines: 70,
      //   functions: 70,
      //   branches: 60,
      //   statements: 70,
      // },
    },
    // Test timeouts
    testTimeout: 10000,
    hookTimeout: 10000,
    // Watch mode settings
    watchExclude: ['node_modules/**', 'dist/**'],
    // Reporter
    reporters: ['default'],
    // Pool settings for better isolation
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
