ALTER TABLE analysis_scratch_draft ADD COLUMN scratch_key TEXT;

UPDATE analysis_scratch_draft
   SET scratch_key = 'legacy-' || scratch_draft_id
 WHERE scratch_key IS NULL;

CREATE UNIQUE INDEX analysis_scratch_by_key
    ON analysis_scratch_draft (scratch_key)
 WHERE scratch_key IS NOT NULL;
