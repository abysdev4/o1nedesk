"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/app/login/actions";
import { LogIn } from "lucide-react";

export default function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="block text-sm text-muted mb-1.5">E-mail</label>
        <input
          name="email"
          type="email"
          autoComplete="username"
          defaultValue="henrique@onedata.com"
          className="input"
          placeholder="voce@empresa.com"
        />
      </div>
      <div>
        <label className="block text-sm text-muted mb-1.5">Senha</label>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          className="input"
          placeholder="••••••••"
        />
      </div>
      {state.error && (
        <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
          {state.error}
        </div>
      )}
      <button type="submit" disabled={pending} className="btn-primary w-full disabled:opacity-60">
        <LogIn size={16} />
        {pending ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
