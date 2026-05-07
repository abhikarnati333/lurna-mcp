import { SignUp } from "@clerk/nextjs";

export default function SignUpCatchAllPage() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </div>
  );
}
