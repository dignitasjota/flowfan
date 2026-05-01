-- Add full-text search support to messages table
-- Uses Spanish + English tsvector for bilingual search

ALTER TABLE messages ADD COLUMN search_vector tsvector;

-- GIN index for fast full-text search
CREATE INDEX messages_search_idx ON messages USING GIN (search_vector);

-- Trigger function to auto-populate search_vector on INSERT/UPDATE
CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('spanish', COALESCE(NEW.content, '')) || to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_search_vector_trigger
  BEFORE INSERT OR UPDATE OF content ON messages
  FOR EACH ROW
  EXECUTE FUNCTION messages_search_vector_update();

-- Backfill existing messages
UPDATE messages
SET search_vector = to_tsvector('spanish', COALESCE(content, '')) || to_tsvector('english', COALESCE(content, ''))
WHERE search_vector IS NULL;
