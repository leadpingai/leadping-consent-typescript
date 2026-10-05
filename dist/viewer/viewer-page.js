import { mountEvidence } from '../sdk/viewer.js';
let dispose;
const input = document.getElementById('evidence-file');
input.addEventListener('change', async () => {
  const error = document.getElementById('error');
  error.textContent = '';
  dispose?.();
  try {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 96 * 1024 * 1024) throw new Error('Evidence export exceeds the viewer limit.');
    dispose = await mountEvidence(document.getElementById('evidence'), JSON.parse(await file.text()));
  } catch (failure) { error.textContent = failure instanceof Error ? failure.message : 'Unable to open evidence.'; }
});
