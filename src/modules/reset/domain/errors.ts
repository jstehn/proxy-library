// Why a reset can be refused (design doc 12).

export type Forbidden = Readonly<{ kind: "Forbidden" }>; // only admins may reset other players
export type PlayerNotFound = Readonly<{ kind: "PlayerNotFound" }>;
