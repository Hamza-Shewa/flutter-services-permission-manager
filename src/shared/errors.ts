/**
 * Custom error classes for better error handling and debugging
 */

export class PermissionManagerError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly context?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'PermissionManagerError';
    }
}

export class FileOperationError extends PermissionManagerError {
    constructor(message: string, filePath: string, cause?: Error) {
        super(message, 'FILE_OPERATION_ERROR', { filePath, cause: cause?.message });
        this.name = 'FileOperationError';
    }
}

export class XmlParseError extends PermissionManagerError {
    constructor(message: string, content?: string) {
        super(message, 'XML_PARSE_ERROR', { contentPreview: content?.slice(0, 100) });
        this.name = 'XmlParseError';
    }
}

export class PlistParseError extends PermissionManagerError {
    constructor(message: string, content?: string) {
        super(message, 'PLIST_PARSE_ERROR', { contentPreview: content?.slice(0, 100) });
        this.name = 'PlistParseError';
    }
}

export class ServiceConfigError extends PermissionManagerError {
    constructor(message: string, serviceId: string) {
        super(message, 'SERVICE_CONFIG_ERROR', { serviceId });
        this.name = 'ServiceConfigError';
    }
}

export class ValidationError extends PermissionManagerError {
    constructor(message: string, field?: string, value?: unknown) {
        super(message, 'VALIDATION_ERROR', { field, value: String(value) });
        this.name = 'ValidationError';
    }
}
