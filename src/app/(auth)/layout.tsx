// Shared frame for the signed-out pages (sign in, register): a narrow centered card.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-16">{children}</main>;
}
