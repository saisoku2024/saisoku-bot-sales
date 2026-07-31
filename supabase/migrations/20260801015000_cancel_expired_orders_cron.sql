-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Function to cancel expired pending orders (older than 5 minutes)
CREATE OR REPLACE FUNCTION public.cancel_expired_pending_orders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.pending_orders
  SET status = 'cancelled',
      cancelled_at = now()
  WHERE status = 'waiting_payment'
    AND created_at <= now() - interval '5 minutes';
END;
$$;

-- Grant execution to service role
GRANT EXECUTE ON FUNCTION public.cancel_expired_pending_orders() TO service_role;

-- Schedule cron job to run every 5 minutes
SELECT cron.schedule(
  'cancel-expired-pending-orders',
  '*/5 * * * *',
  'SELECT public.cancel_expired_pending_orders();'
);
