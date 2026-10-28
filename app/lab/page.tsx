import { redirect } from "next/navigation";

// The Lab's tools now live in the lessons that teach them; the river solver sits on Learn → Tools for now.
// Temporary (307), not permanent: the river solver will move again.
export default function LabPage() {
  redirect("/learn/tools");
}
