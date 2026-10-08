/** The recording cannot support this submission because its allotted time has elapsed. */
export class ReplayLimitExceededError extends Error {
  readonly code = 'replay_limit_exceeded';

  constructor() {
    super("The recording time limit was reached. This submission wasn't captured. Start a new recording and submit again.");
    this.name = 'ReplayLimitExceededError';
  }
}
