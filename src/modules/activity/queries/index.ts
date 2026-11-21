// The activity module's public reads (design doc 67). `src/server/composition/reads.ts` binds the database
// into every function exported here, so pages call `reads.activity.feed(actor, ...)`. It is
// `export *`, not a list of names, so "Go to definition" on `reads.activity.feed` lands on the SQL.
// Only reads are exported from the files listed here; a helper stays unexported.
export * from "./feed";
