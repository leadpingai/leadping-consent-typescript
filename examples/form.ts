import { attach } from '../src/embed.js';

// The form contains [data-leadping-consent] and [data-leadping-disclosure].
const configuration = document.createElement('script');
configuration.dataset.domainId = 'YOUR_PUBLIC_DOMAIN_ID';
configuration.dataset.form = '#lead-form';
configuration.dataset.apiUrl = 'https://consent.leadping.ai';
document.querySelector('#lead-form')!.addEventListener('leadping:success', event => {
  const { certificateId, certificateUrl } = (event as CustomEvent).detail;
  console.log(certificateId, certificateUrl);
});
await attach(configuration);
