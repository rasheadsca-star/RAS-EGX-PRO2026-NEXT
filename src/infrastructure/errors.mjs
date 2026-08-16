export class DataUnavailableError extends Error {
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'DataUnavailableError';
    this.code = code;
    this.details = details;
  }
}
