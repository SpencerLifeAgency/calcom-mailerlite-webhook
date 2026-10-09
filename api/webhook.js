import { createHmac, timingSafeEqual } from 'node:crypto';

// Authenticate original bytes, never a re-serialized object.
export const config = { api: { bodyParser: false } };
const MAX_BODY_BYTES = 256 * 1024;
// Verified existing Family Protection Review; new event types require review.
const WEBSITE_EVENT_IDS = new Set([6935176]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const secret = process.env.CALCOM_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'Server configuration error' });
  const signature = req.headers['x-cal-signature-256'];
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let raw;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_BODY_BYTES) return res.status(413).json({ error: 'Payload too large' });
      chunks.push(bytes);
    }
    raw = Buffer.concat(chunks);
  } catch {
    return res.status(400).json({ error: 'Unable to read request' });
  }
  const expected = createHmac('sha256', secret).update(raw).digest();
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let event;
  try { event = JSON.parse(raw.toString('utf8')); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return res.status(400).json({ error: 'Invalid event' });
  }
  if (event.triggerEvent !== 'BOOKING_CREATED') {
    return res.status(200).json({ message: 'Event ignored' });
  }
  // Standard Cal.com BOOKING_CREATED wraps booking data in payload.
  // No slug/flat fallback: missing and unknown IDs fail closed.
  const booking = event.payload;
  if (!booking || !Number.isSafeInteger(booking.eventTypeId) ||
      !WEBSITE_EVENT_IDS.has(booking.eventTypeId)) {
    return res.status(200).json({ message: 'Event type ignored' });
  }
  const attendee = Array.isArray(booking.attendees) ? booking.attendees[0] : null;
  if (!attendee || typeof attendee.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendee.email) || attendee.email.length > 254) {
    return res.status(400).json({ error: 'Missing or invalid attendee email' });
  }
  const key = process.env.MAILERLITE_API_KEY;
  const group = process.env.MAILERLITE_BOOKED_CALL_GROUP_ID;
  if (!key || !group) return res.status(500).json({ error: 'Server configuration error' });
  try {
    // Preserve the existing group; never forward notes or health details.
    const response = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: attendee.email,
        fields: { name: typeof attendee.name === 'string' ? attendee.name : attendee.email.split('@')[0] },
        groups: [group],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return res.status(502).json({ error: 'Subscriber update failed' });
    return res.status(200).json({ success: true });
  } catch {
    // No subscriber data, tokens, signatures or upstream errors in logs/responses.
    return res.status(502).json({ error: 'Subscriber update failed' });
  }
}
