// Errors meant for the person using the office: plain-language messages the API returns
// as 400s. In its own file so the office's modules can throw it without importing office.ts.

export class OfficeError extends Error {}

/** Setting up from a template stopped part way: the office exists with what was created. */
export class SetupStopped extends OfficeError {}

/** Allowed only on the Mac the office runs on: the API answers 403 (without pair: true, so a
 *  paired phone doesn't reload to the pairing page). */
export class MacOnly extends OfficeError {}

/** Phase 6 (review 6 M4): the request is for another office than the open one, or a switch is
 *  already under way. The API answers 409. */
export class Conflict extends OfficeError {}

/** Phase 6 (M4): the server is switching offices; the API answers 503, try again in a moment. */
export class Busy extends OfficeError {}

/** An employee's AI has no key (or server) on this Mac. Their work is held, not dropped, and
 *  starts again by itself when one is saved (7A-5, S8). */
export class ProviderNotConfigured extends Error {
  readonly provider: 'anthropic' | 'gemini' | 'openai';
  constructor(message: string, provider: 'anthropic' | 'gemini' | 'openai') {
    super(message);
    this.provider = provider;
  }
}
