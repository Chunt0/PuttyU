import type { FormEvent, ReactNode } from "react";

// Shared chrome for the setup/login cards (kit-shaped; full kit port at M0.3).
export function AuthScreen({
  title,
  children,
  error,
  onSubmit,
}: {
  title: string;
  children: ReactNode;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand">
          <img src="/putty-blob.svg" alt="" />
          <span>puttyU</span>
        </div>
        <h1>{title}</h1>
        {children}
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
