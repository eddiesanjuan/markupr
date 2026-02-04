# Contributing to FeedbackFlow

Thank you for your interest in contributing to FeedbackFlow! This document provides guidelines and information about contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Style Guide](#style-guide)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment. Please:

- Be respectful and considerate in all interactions
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Accept responsibility for mistakes and learn from them

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- Git
- A code editor (VS Code recommended)

### Setup

1. **Fork the repository** on GitHub

2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/feedbackflow.git
   cd feedbackflow
   ```

3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/eddiesanjuan/feedbackflow.git
   ```

4. **Install dependencies**:
   ```bash
   npm install
   ```

5. **Start development**:
   ```bash
   npm run dev
   ```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed development instructions.

## How to Contribute

### Types of Contributions

We welcome many types of contributions:

- **Bug fixes**: Fix issues in existing code
- **Features**: Add new functionality
- **Documentation**: Improve or add documentation
- **Tests**: Add or improve test coverage
- **Performance**: Optimize existing code
- **Accessibility**: Improve accessibility
- **Translations**: Help translate the UI

### Finding Issues to Work On

- Check [issues labeled "good first issue"](https://github.com/eddiesanjuan/feedbackflow/labels/good%20first%20issue) for beginner-friendly tasks
- Check [issues labeled "help wanted"](https://github.com/eddiesanjuan/feedbackflow/labels/help%20wanted) for tasks where we need help
- Feel free to propose your own ideas by opening an issue first

### Before Starting Work

1. **Check existing issues** to avoid duplicate work
2. **Comment on the issue** to let others know you're working on it
3. **For significant changes**, open an issue first to discuss the approach
4. **For new features**, wait for approval before starting implementation

## Development Workflow

### Branch Naming

Use descriptive branch names:

- `feature/add-pdf-export`
- `fix/hotkey-conflict`
- `docs/update-readme`
- `refactor/settings-panel`

### Making Changes

1. **Create a branch**:
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make your changes**:
   - Follow the [style guide](#style-guide)
   - Keep commits focused and atomic
   - Write clear commit messages

3. **Test your changes**:
   ```bash
   npm test
   npm run lint
   npm run typecheck
   ```

4. **Update documentation** if needed

5. **Commit your changes**:
   ```bash
   git commit -m "feat: add new export format"
   ```

### Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, etc.)
- `refactor`: Code change that neither fixes nor adds
- `perf`: Performance improvement
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples**:
```
feat(export): add PDF export format
fix(hotkey): resolve conflict with system shortcuts
docs(readme): update installation instructions
refactor(settings): simplify settings manager
```

### Keeping Your Fork Updated

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

## Pull Request Process

### Before Submitting

Ensure your PR:

1. **Follows the style guide**
2. **Passes all tests**: `npm test`
3. **Passes linting**: `npm run lint`
4. **Passes type checking**: `npm run typecheck`
5. **Has been tested manually**
6. **Includes documentation updates** (if applicable)
7. **Has a clear description**

### Submitting a PR

1. **Push your branch**:
   ```bash
   git push origin feature/my-feature
   ```

2. **Open a Pull Request** on GitHub

3. **Fill out the PR template**:
   - Describe what the PR does
   - Link related issues
   - List any breaking changes
   - Include screenshots for UI changes

4. **Request review** if not automatically assigned

### PR Template

```markdown
## Description
Brief description of changes.

## Related Issues
Fixes #123

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactoring
- [ ] Other (describe)

## Testing
Describe how you tested the changes.

## Screenshots
(If applicable)

## Checklist
- [ ] Tests pass (`npm test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Types check (`npm run typecheck`)
- [ ] Documentation updated
- [ ] Manually tested
```

### Review Process

1. **Automated checks** must pass
2. **At least one maintainer** must approve
3. **All comments** must be resolved
4. **No merge conflicts** with main

### After Merging

- Delete your branch
- Pull changes to your local main
- Celebrate your contribution! 🎉

## Style Guide

### TypeScript

```typescript
// Use explicit types
function createSession(sourceId: string): Session {
  // ...
}

// Use interfaces for objects
interface SessionOptions {
  sourceId: string;
  sourceName?: string;
}

// Use const assertions for literals
const STATUS = {
  IDLE: 'idle',
  RECORDING: 'recording',
} as const;
```

### React

```tsx
// Use functional components
export function SessionStatus({ state }: SessionStatusProps) {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    // Cleanup subscriptions
    return () => cleanup();
  }, []);

  return <div className="status">{state}</div>;
}

// Prefer named exports
export { SessionStatus };
```

### CSS / Tailwind

```tsx
// Use Tailwind utilities
<div className="bg-gray-900 text-white p-4 rounded-lg shadow-md">

// For complex styles, use cn() helper
<div className={cn(
  "base-styles",
  isActive && "active-styles",
  className
)}>
```

### File Organization

```
src/
├── main/
│   ├── services/      # Service classes
│   ├── utils/         # Utility functions
│   └── types/         # Main-specific types
├── renderer/
│   ├── components/    # React components
│   ├── hooks/         # Custom hooks
│   └── utils/         # Utility functions
└── shared/
    └── types.ts       # Shared types
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `SessionReview.tsx` |
| Hooks | camelCase, `use` prefix | `useSessionState.ts` |
| Utilities | camelCase | `formatTime.ts` |
| Types | PascalCase | `SessionState` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES` |

## Reporting Issues

### Before Reporting

1. **Check existing issues** for duplicates
2. **Try latest version** - issue may be fixed
3. **Collect information**:
   - OS and version
   - FeedbackFlow version
   - Steps to reproduce
   - Error messages/logs

### Bug Report Template

```markdown
## Description
Clear description of the bug.

## Steps to Reproduce
1. Go to '...'
2. Click on '...'
3. See error

## Expected Behavior
What should happen.

## Actual Behavior
What actually happens.

## Environment
- OS: macOS 14.0
- FeedbackFlow: 0.4.0
- Node: 18.19.0

## Screenshots/Logs
(If applicable)

## Additional Context
Any other relevant information.
```

### Feature Request Template

```markdown
## Problem
Describe the problem this feature would solve.

## Proposed Solution
How you envision the feature working.

## Alternatives Considered
Other approaches you've thought about.

## Additional Context
Mockups, examples, or references.
```

## Questions?

- Open a [discussion](https://github.com/eddiesanjuan/feedbackflow/discussions)
- Check [documentation](docs/)
- Review existing [issues](https://github.com/eddiesanjuan/feedbackflow/issues)

Thank you for contributing to FeedbackFlow!
