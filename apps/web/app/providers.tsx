"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "../lib/auth-context";
import { ImpersonationBanner } from "../components/ui/impersonation-banner";

export function Providers({ children }: { children: ReactNode }): ReactNode {
  return (
    <AuthProvider>
      <ImpersonationBanner />
      {children}
    </AuthProvider>
  );
}
