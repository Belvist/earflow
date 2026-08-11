-- Social feed likes counter and viewer overlay index.
-- Apply after 004_social_feed.sql on existing databases.

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS likes_count INTEGER NOT NULL DEFAULT 0 CHECK (likes_count >= 0);

UPDATE social_posts p
SET likes_count = counts.likes_count
FROM (
  SELECT post_id, COUNT(*)::int AS likes_count
  FROM social_post_likes
  GROUP BY post_id
) counts
WHERE p.id = counts.post_id
  AND p.likes_count IS DISTINCT FROM counts.likes_count;

CREATE INDEX IF NOT EXISTS idx_social_post_likes_user_post
  ON social_post_likes (user_id, post_id);
