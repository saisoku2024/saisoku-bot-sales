-- Add payment_reference_id to pending_orders to store PG transaction reference
ALTER TABLE public.pending_orders ADD COLUMN IF NOT EXISTS payment_reference_id text;
