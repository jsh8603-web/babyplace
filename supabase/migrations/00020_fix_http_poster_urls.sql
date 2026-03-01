-- Fix mixed content: convert HTTP poster URLs to HTTPS
-- Tour API images (visitkorea.or.kr) are accessible via HTTPS
UPDATE events
SET poster_url = REPLACE(poster_url, 'http://', 'https://')
WHERE poster_url LIKE 'http://%';
