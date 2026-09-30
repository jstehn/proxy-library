export type Forbidden = Readonly<{ kind: "Forbidden" }>;
export type SyncAlreadyQueued = Readonly<{ kind: "SyncAlreadyQueued" }>;
export type SetNotFound = Readonly<{ kind: "SetNotFound" }>;
export type ImageNotFound = Readonly<{ kind: "ImageNotFound" }>;
export type ProductNotFound = Readonly<{ kind: "ProductNotFound" }>;
/** The chosen WPN product or photo isn't on the product's set's page (design doc 13). */
export type PhotoNotOnPage = Readonly<{ kind: "PhotoNotOnPage" }>;
export type SlugInvalid = Readonly<{ kind: "SlugInvalid" }>;
