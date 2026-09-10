CREATE TABLE runtime_store_state (
    store_state_id INTEGER PRIMARY KEY CHECK (store_state_id = 1),
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    data_revision INTEGER NOT NULL CHECK (data_revision BETWEEN 0 AND 9007199254740991),
    search_projection_version INTEGER NOT NULL CHECK (search_projection_version >= 0),
    search_state TEXT NOT NULL CHECK (search_state IN ('ready', 'rebuilding', 'failed')),
    updated_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at_utc) IS updated_at_utc)
) STRICT;

CREATE TABLE runtime_schema_migration (
    migration_id INTEGER PRIMARY KEY CHECK (migration_id > 0),
    checksum_sha256 BLOB NOT NULL CHECK (length(checksum_sha256) = 32),
    applied_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', applied_at_utc) IS applied_at_utc)
) STRICT;

CREATE TABLE preference_state (
    preference_state_id INTEGER PRIMARY KEY CHECK (preference_state_id = 1),
    ui_locale TEXT NOT NULL CHECK (ui_locale IN ('de-DE', 'en-GB')),
    preference_revision INTEGER NOT NULL CHECK (preference_revision BETWEEN 1 AND 9007199254740991),
    updated_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at_utc) IS updated_at_utc)
) STRICT;
