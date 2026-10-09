const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { Readable } = require('node:stream');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../api/webhook.js'), 'utf8')
  .replace("import { createHmac, timingSafeEqual } from 'node:crypto';", '')
  .replace('export const config', 'const config')
  .replace('export default async function handler', 'async function handler');
const fixture = (id = 6935176) => ({ triggerEvent: 'BOOKING_CREATED', payload: {
  eventTypeId: id, attendees: [{ email: 'test@example.com', name: 'Test' }],
  additionalNotes: 'NEVER FORWARD THIS',
} });
async function run(event = fixture(), options = {}) {
  const calls = [];
  const raw = options.raw ?? JSON.stringify(event, null, 2);
  const env = { CALCOM_WEBHOOK_SECRET: 'test-only-secret', MAILERLITE_API_KEY: 'fake-key',
    MAILERLITE_BOOKED_CALL_GROUP_ID: 'existing-group', ...options.env };
  const context = vm.createContext({ createHmac, timingSafeEqual, Buffer, AbortSignal,
    process: { env }, fetch: async (...args) => {
      calls.push(args);
      if (options.networkError) throw new Error('PRIVATE UPSTREAM DATA');
      return { ok: options.upstreamOk !== false };
    } });
  vm.runInContext(source + '\nthis.handler = handler;', context);
  const req = Readable.from([Buffer.from(raw.slice(0, 12)), Buffer.from(raw.slice(12))]);
  req.method = options.method || 'POST';
  req.headers = { 'x-cal-signature-256': options.signature === undefined
    ? createHmac('sha256', 'test-only-secret').update(raw).digest('hex') : options.signature };
  const res = { code: 0, headers: {}, setHeader(k,v) { this.headers[k]=v; },
    status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; } };
  await context.handler(req, res);
  return { code: res.code, body: JSON.parse(JSON.stringify(res.body)), calls };
}
test('approved website booking preserves group; uses nested payload and exact raw bytes', async () => {
  const result = await run();
  assert.equal(result.code, 200);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0][0], 'https://connect.mailerlite.com/api/subscribers');
  assert.deepEqual(JSON.parse(result.calls[0][1].body), {
    email: 'test@example.com', fields: { name: 'Test' }, groups: ['existing-group'],
  });
});
for (const id of [7388814, 123, undefined, null, '6935176']) {
  test(`ignores unapproved event ID ${id}`, async () => {
    const event = fixture(); event.payload.eventTypeId = id;
    const r = await run(event); assert.equal(r.code, 200); assert.equal(r.calls.length, 0);
  });
}
for (const signature of [null, '', 'bad', '0'.repeat(64)]) {
  test(`rejects missing/invalid signature ${String(signature).slice(0,8)}`, async () => {
    const r = await run(fixture(), { signature });
    assert.equal(r.code, 401); assert.equal(r.calls.length, 0);
  });
}
test('rejects tampered body', async () => {
  const signature = createHmac('sha256', 'test-only-secret').update(JSON.stringify(fixture())).digest('hex');
  const r = await run(fixture(), { signature }); // different whitespace
  assert.equal(r.code, 401); assert.equal(r.calls.length, 0);
});
test('does not accept flat or slug-only booking data', async () => {
  for (const event of [{ triggerEvent: 'BOOKING_CREATED', ...fixture().payload },
    { triggerEvent: 'BOOKING_CREATED', payload: { type: 'family-protection-review-with-keith' } }]) {
    const r = await run(event); assert.equal(r.calls.length, 0);
  }
});
test('ignores other triggers', async () => {
  const r = await run({ ...fixture(), triggerEvent: 'BOOKING_CANCELLED' });
  assert.equal(r.calls.length, 0);
});
test('rejects malformed JSON, missing attendee, missing secret and non-POST', async () => {
  for (const [event, options, code] of [
    [fixture(), {raw:'{'}, 400], [null, {}, 400],
    [{triggerEvent:'BOOKING_CREATED',payload:{eventTypeId:6935176}}, {}, 400],
    [fixture(), {env:{CALCOM_WEBHOOK_SECRET:''}}, 500],
    [fixture(), {method:'GET'}, 405], [fixture(), {raw:'x'.repeat(262145)}, 413],
  ]) { const r = await run(event,options); assert.equal(r.code,code); assert.equal(r.calls.length,0); }
});
test('upstream failure stays generic, not success', async () => {
  for (const options of [{upstreamOk:false},{networkError:true}]) {
    const r = await run(fixture(),options); assert.equal(r.code,502);
    assert.deepEqual(r.body,{error:'Subscriber update failed'});
  }
});
