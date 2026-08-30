import type { ServiceEntry, ServiceConfig } from '../../core/types/index.js';
import { ServiceValidationError } from '../../core/shared/errors.js';

const XML_SPECIAL_CHARS = /[<>&"']/;

export function validateServiceEntry(entry: ServiceEntry, config: ServiceConfig): ServiceValidationError[] {
  const errors: ServiceValidationError[] = [];
  for (const field of config.fields ?? []) {
    const value = entry.values?.[field.id] ?? '';
    if (field.required && !value.trim()) {
      errors.push(new ServiceValidationError(entry.id, field.id, field.label + ' is required'));
    }
    if (value && XML_SPECIAL_CHARS.test(value)) {
      errors.push(new ServiceValidationError(entry.id, field.id, field.label + ' contains invalid characters'));
    }
    if (field.pattern && value && !new RegExp(field.pattern).test(value)) {
      errors.push(new ServiceValidationError(entry.id, field.id, field.patternError ?? field.label + ' has an invalid format'));
    }
  }
  return errors;
}
