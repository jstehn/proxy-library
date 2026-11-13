import Link from "next/link";
import { FORMATS } from "@/modules/decks";
import { getProfileForEdit } from "@/modules/social";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { ProfileForm } from "./profile-form";

export default async function EditProfilePage() {
  const actor = await requireActor();
  const initial = await getProfileForEdit(getContainer().db, actor.userId);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Edit profile</h1>
          <p className="text-muted text-sm">Customize what other players see on your profile.</p>
        </div>
        <Link href={`/players/${actor.username}`} className="text-sm underline">
          View profile
        </Link>
      </header>
      <ProfileForm initial={initial} formats={FORMATS} />
    </main>
  );
}
