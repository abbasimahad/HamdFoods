"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/server/auth/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const result = await authClient.signIn.email({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        rememberMe: form.get("rememberMe") === "on",
      });
      if (result.error) {
        setError("Invalid email or password.");
        setPending(false);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Unable to sign in. Please try again.");
      setPending(false);
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={submit}>
      <label className="block text-sm font-medium">
        Email
        <input
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
          name="email"
          required
          type="email"
        />
      </label>
      <label className="block text-sm font-medium">
        Password
        <input
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
          name="password"
          required
          type="password"
        />
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input name="rememberMe" type="checkbox" /> Remember me
      </label>
      {error && (
        <p
          className="rounded-lg bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger-ink)]"
          role="alert"
        >
          {error}
        </p>
      )}
      <button
        className="min-h-11 w-full rounded-lg bg-[var(--accent)] px-4 font-semibold text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
