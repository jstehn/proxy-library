import { PASSWORD_MIN_LENGTH } from "@/modules/accounts";
import { requireActor } from "@/server/session";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  const actor = await requireActor({ allowPasswordChangePending: true });

  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold">Change password</h1>
      {actor.mustChangePassword && (
        <p className="border-warning-line bg-warning-soft text-warning-ink rounded-md border px-3 py-2 text-sm">
          An admin reset your password. Choose a new one to continue. Use the temporary password as
          your current password.
        </p>
      )}
      <ChangePasswordForm passwordMinLength={PASSWORD_MIN_LENGTH} />
    </main>
  );
}
