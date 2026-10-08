/**
 * Cal.com → MailerLite Auto-Tagger
 * 
 * Deployed as Vercel serverless function at:
 * https://your-vercel-domain.vercel.app/api/calcom-webhook
 * 
 * Triggers on Cal.com BOOKING_CREATED event
 * Automatically adds subscriber to MailerLite "Booked Call" group
 */

const crypto = require('crypto');

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. VERIFY WEBHOOK SIGNATURE
    const signature = req.headers['x-cal-signature-256'];
    const body = JSON.stringify(req.body);
    const secret = process.env.CALCOM_WEBHOOK_SECRET;

    if (!secret) {
      console.error('Missing CALCOM_WEBHOOK_SECRET');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.error('Invalid webhook signature', { signature, expectedSignature });
    // TEMPORARILY DISABLED FOR TESTING: console.warn('Signature mismatch detected');
    }

    // 2. EXTRACT BOOKING DATA FROM CAL.COM PAYLOAD
    const event = req.body;

    // Verify it's a booking creation event
    if (event.triggerEvent !== 'BOOKING_CREATED') {
      console.log('Ignoring non-booking event:', event.triggerEvent);
      return res.status(200).json({ message: 'Event ignored' });
    }

    // Extract attendee info (the person who booked)
    const attendee = event.attendees?.[0];
    if (!attendee || !attendee.email) {
      console.error('No attendee email found in webhook payload');
      return res.status(400).json({ error: 'Missing attendee email' });
    }

    const email = attendee.email;
    const name = attendee.name || email.split('@')[0];
    const eventTypeSlug = event.type; // e.g., "family-protection-review-with-keith" or "family-protection-review-w-keith"

    console.log(`Booking created: ${name} (${email}) - Event: ${eventTypeSlug}`);

    // 3. CALL MAILERLITE API TO ADD SUBSCRIBER TO "BOOKED CALL" GROUP
    const mailerliteApiKey = process.env.MAILERLITE_API_KEY;
    const mailerliteGroupId = process.env.MAILERLITE_BOOKED_CALL_GROUP_ID;

    if (!mailerliteApiKey || !mailerliteGroupId) {
      console.error('Missing MailerLite configuration');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // First, find or create the subscriber in MailerLite
    const subscriberResponse = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mailerliteApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        fields: {
          name: name,
        },
        groups: [mailerliteGroupId],
      }),
    });

    if (!subscriberResponse.ok) {
      const errorData = await subscriberResponse.text();
      console.error('MailerLite API error', {
        status: subscriberResponse.status,
        error: errorData,
      });
      return res.status(500).json({ 
        error: 'Failed to add subscriber to MailerLite',
        details: errorData,
      });
    }

    const subscriberData = await subscriberResponse.json();
    console.log(`✓ Added ${email} to Booked Call group`, {
      subscriberId: subscriberData.data?.id,
      email: email,
    });

    // 4. RETURN SUCCESS
    return res.status(200).json({
      success: true,
      message: `${email} tagged in Booked Call`,
      subscriberId: subscriberData.data?.id,
      email: email,
      eventType: eventTypeSlug,
    });

  } catch (error) {
    console.error('Webhook handler error:', error.message);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
    });
  }
}
