import Link from "next/link";
import { FORMATS } from "@/modules/decks";
import { ProfileForm } from "./profile-form";
import { readPage } from "@/server/page-instance";

export default async function EditProfilePage() {
  const { actor, reads } = await readPage();
  const initial = await reads.social.profileForEdit(actor);

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
