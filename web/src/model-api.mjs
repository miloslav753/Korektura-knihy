import {reviewPrompt, parseReviewResponse} from './review-format.mjs';

export const modelPresets = {
  openai: {name: 'GPT-4.1', model: 'gpt-4.1', endpoint: 'https://api.openai.com/v1/chat/completions'},
  qwen: {name: 'Qwen3-235B Instruct', model: 'qwen/qwen3-235b-a22b-2507', endpoint: 'https://openrouter.ai/api/v1/chat/completions'},
};
export async function checkWithModel(review, {provider, key}, {fetcher = fetch, progress = () => {}, cancelled = () => false} = {}) {
  const preset = modelPresets[provider];
  if (!preset || !key?.trim()) throw new Error('Vyberte poskytovatele a zadejte jeho API klíč. Předplatné Plus není API klíč.');
  const corrections = [], warnings = []; let promptTokens = 0, completionTokens = 0;
  for (let index = 0; index < review.jobs.length; index++) {
    if (cancelled()) throw new Error('CANCELLED');
    const job = review.jobs[index];
    const report = message => progress({done: index, total: review.jobs.length, block: index + 1, stage: 'model', message});
    report(`Model ${preset.name} kontroluje blok ${index + 1}/${review.jobs.length}…`);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 150000);
    const pulse = setInterval(() => {
      if (cancelled()) controller.abort();
      else report(`Čekám na model ${preset.name} · blok ${index + 1}/${review.jobs.length}…`);
    }, 5000);
    let response;
    try {
      response = await fetcher(preset.endpoint, {method: 'POST', signal: controller.signal, credentials: 'omit',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}`},
        body: JSON.stringify({model: preset.model, temperature: .1, max_tokens: 8000,
          response_format: {type:'json_object'}, messages: [{role:'system',content:'Jsi pečlivý český jazykový korektor. Vrať pouze požadovaný JSON.'},
            {role:'user',content:reviewPrompt(job, review.options)}]})});
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error('API klíč není platný nebo nemá přístup k modelu.');
        if (response.status === 402) throw new Error('U poskytovatele modelu chybí kredit. Plus API kredit nezahrnuje.');
        if (response.status === 429) throw new Error('Poskytovatel omezil počet požadavků. Zkuste kontrolu později.');
        throw new Error(`Jazykový model není dostupný (HTTP ${response.status}). Žádný neúplný výsledek nebude vydáván za hotovou kontrolu.`);
      }
      const payload = await response.json();
      if (payload.choices?.[0]?.finish_reason === 'length') throw new Error('Model vrátil zkrácenou odpověď. Zkuste menší rozsah nebo ruční přenos.');
      const parsed = parseReviewResponse(payload.choices?.[0]?.message?.content, review, job);
      corrections.push(...parsed.accepted);
      if (parsed.rejected.length) warnings.push(`Blok ${index + 1}: ${parsed.rejected.length} návrhů bylo odmítnuto při ověření původního textu a chráněných výrazů.`);
      promptTokens += Number(payload.usage?.prompt_tokens) || 0;
      completionTokens += Number(payload.usage?.completion_tokens) || 0;
    } catch (error) {
      if (cancelled()) throw new Error('CANCELLED');
      if (error.name === 'AbortError') throw new Error('Model neodpověděl v časovém limitu. Již odeslaný požadavek může poskytovatel účtovat.');
      if (error.name === 'TypeError') throw new Error('Nepodařilo se připojit k API modelu. Zkontrolujte internetové připojení a přístup prohlížeče ke službě.');
      throw error;
    } finally { clearTimeout(deadline); clearInterval(pulse); }
    progress({done:index + 1,total:review.jobs.length,block:index + 1,stage:'model',message:`Hotovo ${index + 1}/${review.jobs.length} bloků`});
  }
  return {corrections, metadata: {engine:preset.name, provider, completedBlocks:review.jobs.length, totalBlocks:review.jobs.length,
    usage:{promptTokens,completionTokens}, warnings}};
}
