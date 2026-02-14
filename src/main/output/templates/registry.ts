/**
 * TemplateRegistry - Manages available output templates
 *
 * Singleton that holds all registered templates. Built-in templates are
 * registered on import. Custom templates can be added at runtime.
 */

import type { OutputTemplate } from './types';

class TemplateRegistryImpl {
  private templates = new Map<string, OutputTemplate>();

  /**
   * Register a template. Overwrites any existing template with the same name.
   */
  register(template: OutputTemplate): void {
    this.templates.set(template.name, template);
  }

  /**
   * Get a template by name. Returns undefined if not found.
   */
  get(name: string): OutputTemplate | undefined {
    return this.templates.get(name);
  }

  /**
   * Check if a template with the given name exists.
   */
  has(name: string): boolean {
    return this.templates.has(name);
  }

  /**
   * List all registered template names.
   */
  list(): string[] {
    return Array.from(this.templates.keys());
  }

  /**
   * List all registered templates with their descriptions.
   */
  listWithDescriptions(): Array<{ name: string; description: string; fileExtension: string }> {
    return Array.from(this.templates.values()).map((t) => ({
      name: t.name,
      description: t.description,
      fileExtension: t.fileExtension,
    }));
  }

  /**
   * Get the default template name.
   */
  getDefault(): string {
    return 'markdown';
  }
}

/** Singleton template registry */
export const templateRegistry = new TemplateRegistryImpl();
export { TemplateRegistryImpl };
