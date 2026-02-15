/**
 * Output Templates — Barrel Export
 *
 * Importing this module registers all built-in templates with the registry.
 */

export type { OutputTemplate, TemplateContext, TemplateOutput } from './types';
export { templateRegistry, TemplateRegistryImpl } from './registry';
export { markdownTemplate } from './markdown';
export { jsonTemplate } from './json';
export { githubIssueTemplate } from './github-issue';
export { linearTemplate } from './linear';
export { jiraTemplate } from './jira';

// Register built-in templates
import { templateRegistry } from './registry';
import { markdownTemplate } from './markdown';
import { jsonTemplate } from './json';
import { githubIssueTemplate } from './github-issue';
import { linearTemplate } from './linear';
import { jiraTemplate } from './jira';

templateRegistry.register(markdownTemplate);
templateRegistry.register(jsonTemplate);
templateRegistry.register(githubIssueTemplate);
templateRegistry.register(linearTemplate);
templateRegistry.register(jiraTemplate);
