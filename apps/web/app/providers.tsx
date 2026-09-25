"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "../lib/auth-context";

export function Providers({ children }: { children: ReactNode }): ReactNode {
  return <AuthProvider>{children}</AuthProvider>;
}
