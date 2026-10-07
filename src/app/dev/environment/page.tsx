import { notFound } from "next/navigation";
import { EnvironmentLab } from "@/features/environment-lab/lab";
export const metadata = {
  title: "Environment Lab",
  robots: { index: false, follow: false },
};
export default function Page() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_ENABLE_ENVIRONMENT_LAB !== "true"
  )
    notFound();
  return <EnvironmentLab />;
}
