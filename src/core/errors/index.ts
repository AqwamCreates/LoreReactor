/**
 * Custom error classes for the LoreReactor application
 */

/**
 * Base error class for all application-specific errors
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * Error thrown when an entity is not found
 */
export class NotFoundError extends AppError {
  constructor(entityType: string, id: string) {
    super(`${entityType} with ID '${id}' not found`, 'NOT_FOUND', { entityType, id });
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Error thrown when an operation is not allowed
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Operation not allowed') {
    super(message, 'FORBIDDEN');
    this.name = 'ForbiddenError';
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

/**
 * Error thrown when a conflict occurs (e.g., duplicate entity)
 */
export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', details);
    this.name = 'ConflictError';
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

/**
 * Error thrown when an external service fails
 */
export class ExternalServiceError extends AppError {
  constructor(serviceName: string, message: string, details?: Record<string, unknown>) {
    super(`${serviceName}: ${message}`, 'EXTERNAL_SERVICE_ERROR', { serviceName, ...details });
    this.name = 'ExternalServiceError';
    Object.setPrototypeOf(this, ExternalServiceError.prototype);
  }
}

/**
 * Error thrown when a network request fails
 */
export class NetworkError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'NETWORK_ERROR', details);
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * Error thrown when token generation fails
 */
export class GenerationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'GENERATION_ERROR', details);
    this.name = 'GenerationError';
    Object.setPrototypeOf(this, GenerationError.prototype);
  }
}

/**
 * Error thrown when storage operations fail
 */
export class StorageError extends AppError {
  constructor(operation: string, message: string, details?: Record<string, unknown>) {
    super(`Storage ${operation} failed: ${message}`, 'STORAGE_ERROR', { operation, ...details });
    this.name = 'StorageError';
    Object.setPrototypeOf(this, StorageError.prototype);
  }
}
