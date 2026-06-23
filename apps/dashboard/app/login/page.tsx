import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";

export default async function LoginPage() {
  const s = await getSession();
  if (s) redirect("/");

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-white.png" alt="OneDesk" className="h-12 w-auto" />
          <p className="text-sm text-muted mt-3">Console de suporte remoto</p>
        </div>
        <div className="card p-6">
          <LoginForm />
        </div>
        <p className="text-center text-xs text-muted mt-6">
          Acesso restrito a tecnicos autorizados.
        </p>
      </div>
    </div>
  );
}
