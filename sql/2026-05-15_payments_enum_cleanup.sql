-- Align legacy enums with current Razorpay-only implementation.

-- Backfill legacy status name.
UPDATE payments
   SET status = 'created'
 WHERE status = 'initiated';

-- payments.provider: drop 'stripe' if present
ALTER TABLE payments
  MODIFY COLUMN provider ENUM('razorpay') NOT NULL;

-- payments.status: ensure 'created' exists (older migrations used 'initiated')
ALTER TABLE payments
  MODIFY COLUMN status ENUM('created','pending','authorized','captured','failed','refunded') NOT NULL DEFAULT 'created';

-- webhook_events.provider: drop 'stripe' if present
ALTER TABLE webhook_events
  MODIFY COLUMN provider ENUM('razorpay') NOT NULL;
