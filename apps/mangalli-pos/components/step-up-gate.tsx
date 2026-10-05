import { LockKeyhole } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { unlockSettingsAction } from "@/app/actions";
import { ActionForm } from "@/components/interactive";
import { PinField } from "@/components/pin-field";
import type { Operator } from "@/server/auth";
import { hasStepUpSecret, STEP_UP_MINUTES, stepUpUntil } from "@/server/step-up";

// Halaman yang memuat data penting (QRIS, pembayaran, pajak, tim) baru terbuka
// setelah PIN persetujuan 6 angka dimasukkan lagi (sama dengan PIN di tablet). Aksi di
// dalamnya juga diperiksa di server (requireStepUp), bukan hanya disembunyikan.
export async function StepUpGate({ operator, title, next, children }: { operator: Operator; title: string; next: string; children: ReactNode }) {
  if (!(await hasStepUpSecret(operator))) {
    return (
      <>
        <div className="page step-up-hint"><p className="notice">Set your approval PIN in <Link href="/admin/users">Team</Link> to protect these settings.</p></div>
        {children}
      </>
    );
  }
  if (await stepUpUntil(operator)) return children;
  // Terkunci: halaman tetap terlihat di belakang tetapi inert (tidak bisa
  // diklik, difokus, atau diketik), dengan dialog PIN gaya dialog dashboard.
  // Perubahan apa pun tetap ditolak server tanpa PIN (requireStepUp).
  return (
    <>
      <div aria-hidden="true" className="step-up-behind" inert>{children}</div>
      <div className="dialog-backdrop step-up-backdrop">
        <section aria-labelledby="step-up-title" aria-modal="true" className="dialog step-up" role="dialog">
          <span className="step-up-icon"><LockKeyhole size={20} /></span>
          <div>
            <h2 id="step-up-title">Enter your PIN</h2>
            <p>Opens {title} for {STEP_UP_MINUTES} minutes.</p>
          </div>
          <ActionForm action={unlockSettingsAction} className="step-up-form" toast={false}>
            <input name="next" type="hidden" value={next} />
            <PinField autoSubmit keypad />
          </ActionForm>
        </section>
      </div>
    </>
  );
}
