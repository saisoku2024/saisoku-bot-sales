-- Migration: Add trx_code to pending_orders for human-readable order IDs (SSID-YYYYMMDD-000001)
alter table public.pending_orders add column if not exists trx_code text;
