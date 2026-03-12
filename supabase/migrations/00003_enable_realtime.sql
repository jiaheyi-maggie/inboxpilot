-- Enable Supabase Realtime on the emails table
-- This allows the client to subscribe to INSERT/UPDATE/DELETE events
-- Run this in Supabase SQL Editor

ALTER PUBLICATION supabase_realtime ADD TABLE emails;
