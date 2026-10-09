// Exclusions apply to descendants too, including later text/attribute mutations.
const excluded = ':is(.rr-block, .rr-ignore, [data-leadping-exclude])';

/** Fixed privacy policy; callers cannot turn credential protection off. */
export const recordingPrivacy = {
  // Disclosure text and checkbox state remain visible. Recipient identity is sent
  // explicitly with submission; replay does not need raw text-field values.
  maskAllInputs: true,
  maskTextClass: 'rr-mask',
  maskTextSelector: '[data-leadping-mask]',
  blockClass: 'rr-block',
  ignoreClass: 'rr-ignore',
  blockSelector: [
    excluded, `${excluded} *`,
    // Block credential controls entirely so default values and other attributes
    // cannot leak, including password visibility toggles and hidden tokens.
    'input[type="password" i]', 'input[type="hidden" i]', '[data-rr-is-password]',
    '[autocomplete~="current-password" i]', '[autocomplete~="new-password" i]',
    '[autocomplete~="one-time-code" i]', '[autocomplete~="username" i]',
  ].join(', '),
};

/** Required evidence must not bypass an explicit privacy exclusion via custom events or submission. */
export function assertRecordableConsent(disclosure: HTMLElement, checkbox: HTMLElement): void {
  const privateContent = `${recordingPrivacy.blockSelector}, .rr-mask, [data-leadping-mask]`;
  if (disclosure.closest(privateContent) || checkbox.closest(privateContent) || disclosure.querySelector(privateContent))
    throw new Error('The consent disclosure and control must not contain or be inside excluded or masked content.');
}
