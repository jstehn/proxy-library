"use client";
// What a player sees when a page throws. The message and the stack stay in the server log: the
// player gets a plain sentence, a "Try again" button and a way home.
import Link from "next/link";
import { Button, buttonClass } from "@/ui/button";
import { PageMessage } from "@/ui/page-message";

export default function RouteError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { retry } = props;
  return (
    <PageMessage
      title="Something went wrong"
      actions={
        <>
          <Button onClick={() => retry()}>Try again</Button>
          <Link href="/" className={buttonClass({ variant: "secondary" })}>
            Go home
          </Link>
        </>
      }
    >
      This page could not be shown. Trying again often works; if it does not, come back a little
      later.
    </PageMessage>
  );
}
