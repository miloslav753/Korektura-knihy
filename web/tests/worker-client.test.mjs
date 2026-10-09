import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkerClient} from '../src/worker-client.mjs';

class Worker {
  messages = []; terminated = false;
  postMessage(message) { this.messages.push(message); }
  emit(data) { this.onmessage({data}); }
  terminate() { this.terminated = true; }
}
test('An early upload waits for worker readiness instead of losing its request', async () => {
  const worker = new Worker(), client = new WorkerClient(worker, {});
  const bytes = new ArrayBuffer(8);
  const pending = client.request('inspect', {bytes}, [bytes]);
  await Promise.resolve(); assert.equal(worker.messages.length, 1);
  worker.emit({type: 'ready'}); await Promise.resolve();
  assert.equal(worker.messages[1].type, 'inspect');
  worker.emit({type: 'metadata', id: worker.messages[1].id, pages: 2});
  assert.equal((await pending).pages, 2); client.close();
});
test('A failed boot rejects queued uploads and releases the worker', async () => {
  const worker = new Worker(), client = new WorkerClient(worker, {});
  const pending = client.request('inspect');
  worker.emit({type: 'boot-error', message: 'Poškozený slovník'});
  await assert.rejects(pending, /Poškozený slovník/); assert(worker.terminated);
});
test('A crashed worker rejects inspection rather than leaving loading forever', async () => {
  const worker = new Worker(), client = new WorkerClient(worker, {});
  worker.emit({type: 'ready'});
  const pending = client.request('inspect'); await Promise.resolve();
  worker.onerror({message: 'Out of memory'});
  await assert.rejects(pending, /Out of memory/); assert.equal(client.pending.size, 0);
});
test('A silent worker times out and reports a recoverable failure', async () => {
  const worker = new Worker(); let reported;
  const client = new WorkerClient(worker, {}, {requestTimeout: 20, onFailure: error => { reported = error; }});
  worker.emit({type: 'ready'});
  await assert.rejects(client.request('inspect'), /Načítání PDF trvá/);
  assert(reported); assert(worker.terminated);
});
test('Long processing remains active while real progress arrives', async () => {
  const worker = new Worker(), client = new WorkerClient(worker, {}, {processTimeout: 80});
  worker.emit({type: 'ready'});
  const pending = client.request('process'); await Promise.resolve();
  const pulse = setInterval(() => worker.emit({type: 'progress', done: 1, total: 20}), 10);
  await new Promise(resolve => setTimeout(resolve, 110)); clearInterval(pulse);
  worker.emit({type: 'result', id: worker.messages[1].id, result: {checkedPages: 20}});
  assert.equal((await pending).result.checkedPages, 20); client.close();
});
test('Stopping releases memory and rejects active work immediately', async () => {
  const worker = new Worker(), client = new WorkerClient(worker, {});
  worker.emit({type: 'ready'});
  const pending = client.request('process'); await Promise.resolve(); client.close();
  await assert.rejects(pending, /zastaveno/); assert(worker.terminated);
});
