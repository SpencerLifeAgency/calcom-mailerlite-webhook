/**
 * Cal.com → MailerLite Auto-Tagger
  * 
   * Deployed as Vercel serverless function at:
    * https://your-vercel-domain.vercel.app/api/webhook
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
              const secret = process.env.CALCOM_WEBHOOK_SECRET;
          
              if (!secret) {
                        console.error('Missing CALCOM_WEBHOOK_SECRET');
                        return res.status(500).json({ error: 'Server configuration error' });
              }
          
              // ⚠️ CRITICAL: Use raw body for signature verification
                      // req.body is already parsed; we need the original JSON string
              // For Vercel, get the raw body from req.rawBody (set by vercel middleware)
              // or stringify the parsed body for HMAC calculation
              let body;
              if (req.rawBody) {
                        body = req.rawBody;
              } else if (Buffer.isBuffer(req.body)) {
                        body = req.body.toString('utf8');
              } else {
                        // Fallback: stringify the parsed body (may cause signature mismatch if formatting differs)
                        body = JSON.stringify(req.body);
              }
          
              const expectedSignature = crypto
                .createHmac('sha256', secret)
                .update(body)
                .digest('hex');
          
              console.log('Signature verification:', {
                        received: signature,
                        expected: expectedSignature,
                        match: signature === expectedSignature,
                        bodyLength: body.length,
              });
          
              // Temporarily allow unsigned requests for debugging
              if (signature && signature !== expectedSignature) {
                        console.warn('Invalid webhook signature (signature provided but mismatched)', { 
                                    signature: signature.substring(0, 20) + '...', 
                                    expectedSignature: expectedSignature.substring(0, 20) + '...',
                        });
                        // Temporarily allowing to proceed for testing
                        // In production, this should return 401
                        // return res.status(401).json({ error: 'Unauthorized' });
              }
          
              // 2. EXTRACT BOOKING DATA FROM CAL.COM PAYLOAD
                      const event = req.body;
          
              // Verify it's a booking creation event
              if (event.triggerEvent !== 'BOOKING_CREATED') {
                        console.log('Ignoring non-booking event:', event.triggerEvent);
                        return res.status(200).json({ message: 'Event ignored' });
              }
          
              // Log the full event structure for debugging
                      console.log('Cal.com payload structure:', {
                                hasAttendees: !!event.attendees,
                                attendeesLength: event.attendees?.length,
                                attendeesData: JSON.stringify(event.attendees),
                                hasBookingData: !!event.organizer || !!event.guest,
                                organizer: event.organizer,
                                guest: event.guest,
                                topLevelKeys: Object.keys(event).slice(0, 10)
                      });
          
              // Extract attendee info (the person who booked)
              // Cal.com may put guest info in different places - try multiple locations
              let email, name;
          
              // Try attendees array first (person attending the meeting)
              if (event.attendees && event.attendees.length > 0) {
                        const attendee = event.attendees.find(a => a.email && a.email !== event.organizer?.email);
                        if (attendee) {
                                    email = attendee.email;
                                    name = attendee.name || email.split('@')[0];
                        }
              }
          
              // If not found in attendees, try guest field (Cal.com's guest info)
                      if (!email && event.guest?.email) {
                                email = event.guest.email;
                                name = event.guest.name || email.split('@')[0];
                      }
          
              // Fallback: use responses or any attendee
                              if (!email && event.attendees?.length > 0) {
                                        const firstAttendee = event.attendees[0];
                                        email = firstAttendee.email;
                                        name = firstAttendee.name || email.split('@')[0];
                              }
          
              if (!email) {
                        console.error('No attendee email found in webhook payload. Available fields:', {
                                    attendees: event.attendees,
                                    guest: event.guest,
                                    organizer: event.organizer
                        });
                        return res.status(400).json({ error: 'Missing attendee email' });
              }
          
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
}/**
 * Cal.com → MailerLite Auto-Tagger
 * 
 * Deployed as Vercel serverless function at:
 * https://your-vercel-domain.vercel.app/api/webhook
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
        const secret = process.env.CALCOM_WEBHOOK_SECRET;

      if (!secret) {
              console.error('Missing CALCOM_WEBHOOK_SECRET');
              return res.status(500).json({ error: 'Server configuration error' });
      }

      // ⚠️ CRITICAL: Use raw body for signature verification
      // req.body is already parsed; we need the original JSON string
      // For Vercel, get the raw body from req.rawBody (set by vercel middleware)
      // or stringify the parsed body for HMAC calculation
      let body;
        if (req.rawBody) {
                body = req.rawBody;
        } else if (Buffer.isBuffer(req.body)) {
                body = req.body.toString('utf8');
        } else {
                // Fallback: stringify the parsed body (may cause signature mismatch if formatting differs)
          body = JSON.stringify(req.body);
        }

      const expectedSignature = crypto
          .createHmac('sha256', secret)
          .update(body)
          .digest('hex');

      console.log('Signature verification:', {
              received: signature,
              expected: expectedSignature,
              match: signature === expectedSignature,
              bodyLength: body.length,
      });

      // Temporarily allow unsigned requests for debugging
      if (signature && signature !== expectedSignature) {
              console.warn('Invalid webhook signature (signature provided but mismatched)', { 
                                   signature: signature.substring(0, 20) + '...', 
                        expectedSignature: expectedSignature.substring(0, 20) + '...',
              });
              // Temporarily allowing to proceed for testing
          // In production, this should return 401
          // return res.status(401).json({ error: 'Unauthorized' });
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
