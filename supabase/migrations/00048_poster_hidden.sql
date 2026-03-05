-- Add poster_hidden flag for admin to hide inappropriate poster images
ALTER TABLE events ADD COLUMN IF NOT EXISTS poster_hidden BOOLEAN DEFAULT false;
