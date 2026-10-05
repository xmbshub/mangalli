import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Image from "next/image";

import { loginAction } from "@/app/actions";
import { ActionForm, FormFooter, SubmitButton } from "@/components/interactive";
import { config } from "@/server/config";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  if (config.identityProxyEnabled) redirect("/_1garis/login");
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo"><Image loading="eager" src="/images/brands/mangalli-fnb-logo.png" alt="Mangalli POS" width={44} height={44} /></div>
        <div><p className="eyebrow">Mangalli POS · Mulai jualan, tanpa ribet.</p><h1>Welcome back</h1><p>Sign in to manage your outlet.</p></div>
        <ActionForm action={loginAction}>
          <label className="field">Outlet<input defaultValue={config.defaultOutletKey} name="outletKey" required /></label>
          <label className="field">Email<input autoComplete="username" name="email" required type="email" /></label>
          <label className="field">Password<input autoComplete="current-password" name="password" required type="password" /></label>
          <FormFooter><SubmitButton className="button primary block" pendingLabel="Signing in…">Sign in</SubmitButton></FormFooter>
        </ActionForm>
        <small className="muted">In production, sign-in goes through your central 1garis account.</small>
        <small className="app-credit">Mangalli POS · <a href="https://1garis.id" rel="noreferrer" target="_blank">Developed by 1garis Studio</a></small>
      </section>
    </main>
  );
}
