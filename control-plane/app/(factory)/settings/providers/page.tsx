import { redirect } from "next/navigation";

/** Provider profiles moved: factory defaults live in Settings, each project's in its own settings. */
export default function ProvidersRedirect() {
  redirect("/settings");
}
