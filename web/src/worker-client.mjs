// Keep requests until boot completes; every failed worker rejects its waiters.
export class WorkerClient {
  constructor(worker, assets, {onEvent = () => {}, onFailure = () => {}, bootTimeout = 120000,
    requestTimeout = 120000, processTimeout = 180000} = {}) {
    this.worker = worker; this.pending = new Map(); this.id = 0; this.failure = null;
    this.onEvent = onEvent; this.onFailure = onFailure;
    this.requestTimeout = requestTimeout; this.processTimeout = processTimeout;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.ready.catch(() => {});
    this.bootTimer = setTimeout(() => this.fail(new Error('Příprava aplikace trvá příliš dlouho. Zkuste ji obnovit tlačítkem níže.')), bootTimeout);
    worker.onerror = event => this.fail(new Error(`Pracovní proces se zastavil. ${event.message || 'Prohlížeči mohla dojít paměť.'}`));
    worker.onmessageerror = () => this.fail(new Error('Prohlížeč nedokázal předat data PDF. Zkuste menší soubor.'));
    worker.onmessage = ({data}) => {
      if (this.failure) return;
      if (data.type === 'boot-error') { this.fail(new Error(data.message)); return; }
      if (data.type === 'ready') { clearTimeout(this.bootTimer); this.resolveReady(); }
      if (['progress', 'ocr-status'].includes(data.type)) {
        for (const task of this.pending.values()) if (task.type === 'process') this.arm(task);
      }
      const task = this.pending.get(data.id);
      if (task) {
        clearTimeout(task.timer); this.pending.delete(data.id);
        if (['error', 'cancelled'].includes(data.type)) task.reject(new Error(data.message));
        else task.resolve(data);
      } else this.onEvent(data);
    };
    try { worker.postMessage({type: 'boot', assets}); } catch (error) { this.fail(error); }
  }
  arm(task) {
    clearTimeout(task.timer);
    task.timer = setTimeout(() => this.fail(new Error(task.type === 'process'
      ? 'Kontrola dlouho neposkytla žádný průběh. Zkuste menší rozsah stran nebo vypnout OCR.'
      : 'Načítání PDF trvá příliš dlouho. Zkuste menší soubor nebo aplikaci obnovte.')), task.timeout);
  }
  async request(type, payload = {}, transfer = []) {
    await this.ready;
    if (this.failure) throw this.failure;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const task = {type, resolve, reject, timeout: type === 'process' ? this.processTimeout : this.requestTimeout};
      this.pending.set(id, task); this.arm(task);
      try { this.worker.postMessage({type, id, ...payload}, transfer); }
      catch (error) { clearTimeout(task.timer); this.pending.delete(id); reject(error); }
    });
  }
  fail(error, notify = true) {
    if (this.failure) return;
    this.failure = error; clearTimeout(this.bootTimer); this.rejectReady(error);
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(error); }
    this.pending.clear(); this.worker.terminate();
    if (notify) this.onFailure(error);
  }
  close(message = 'Zpracování bylo zastaveno. Vyberte PDF znovu.') { this.fail(new Error(message), false); }
}
