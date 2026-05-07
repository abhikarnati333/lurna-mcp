import { SignIn } from "@clerk/nextjs";

export default function SignInCatchAllPage() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
    </div>
  );
}
