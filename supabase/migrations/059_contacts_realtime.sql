-- Enable realtime on contacts so the client can play a notification
-- sound when a new lead (contact) arrives, without polling. RLS on
-- the contacts table already scopes this correctly per-user, same as
-- the existing conversations/messages/notifications publications.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
  END IF;
END $$;
