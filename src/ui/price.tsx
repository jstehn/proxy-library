// Money for display. One way to show a missing amount: an em dash.
import { Cents } from "@/shared/kernel";

export function Price(props: { cents: Cents | null | undefined }) {
  return <>{props.cents == null ? "—" : Cents.format(props.cents)}</>;
}
