import { redirect } from "next/navigation";

/** /admin on its own goes to the first admin page. */
export default function AdminHome() {
  redirect("/admin/players");
}
