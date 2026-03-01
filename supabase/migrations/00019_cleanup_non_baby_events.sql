-- Clean up existing seoul_events data before re-collecting with baby-relevance filter
DELETE FROM events WHERE source = 'seoul_events';
