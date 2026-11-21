import Link from "next/link";
import { buttonClass } from "@/ui/button";
import { PageMessage } from "@/ui/page-message";

export default function RouteNotFound() {
  return (
    <PageMessage
      title="Not found"
      actions={
        <Link href="/" className={buttonClass({ variant: "secondary" })}>
          Go home
        </Link>
      }
    >
      There is nothing at this address, or it belongs to someone else.
    </PageMessage>
  );
}
