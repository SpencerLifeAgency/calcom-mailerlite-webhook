# Booking isolation repair — October 8, 2026

Released via CLI after 8 hosted preview tests passed. Production deployment:
dpl_EyCQVjwWRTREaLDTWQVuj3EZ7VLB. Existing Production settings preserved; no test
credential overrides. Public GET=405 and unsigned POST=401 verified. Legitimate
Cal.com delivery remains to be tested. Prior production source: 32f7180.
IMPORTANT: repaired local files are not yet committed/pushed. Sync before future
Git deployments to avoid reinstating the old handler. The tested deployment used
the exact handler with a minimal Node 24 ES-module package.

- Only verified Family Protection Review event ID 6935176 can update the existing
  MAILERLITE_BOOKED_CALL_GROUP_ID. Ethos ID 7388814 and missing/unknown IDs are ignored.
- Enforces SHA256 HMAC over original request bytes; rejects missing/bad signatures.
- Uses the standard BOOKING_CREATED payload wrapper rather than root attendee fields.
- Preserves existing destination group configuration; forwards only name/email.
- Removes sensitive signature/subscriber logging and upstream error details.
- Bounds request size and downstream wait time. No new packages or credentials.

Run `node --test test/webhook.test.cjs`: 15 passing mocked tests. No real MailerLite
calls or customer messages were sent. Native module import also checked.

Before production: deploy a preview with fake MailerLite settings (never real
subscriber credentials), confirm raw-body handling and signed ignored-event behavior.
Confirm existing Cal.com/Vercel secrets match via a controlled signed request without
revealing or changing them. Review any other website booking IDs before adding them;
never allow all event types as a fallback. Do not activate Ethos booking availability.

Limitations: signature validation alone does not prevent replay; no persistent
deduplication store is introduced. A repeated valid website request can repeat the
subscriber update, as previously. Production delivery and automation effects require
a separately controlled test. No claim of live isolation until deployment is verified.

References:
- https://cal.com/docs/developing/guides/automation/webhooks
- https://vercel.com/kb/guide/how-do-i-get-the-raw-body-of-a-serverless-function
