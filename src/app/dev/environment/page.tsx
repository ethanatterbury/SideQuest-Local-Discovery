import { EnvironmentLab } from "@/features/environment-lab/lab";
export const metadata = {
  title: "Environment Lab",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <EnvironmentLab />;
}
