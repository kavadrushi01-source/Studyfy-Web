"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { cardStyle, colors, mutedStyle } from "@/lib/theme";
import { useAuth } from "@/lib/auth-context";
import { loginHref } from "@/lib/auth-navigation";
import { boardPathForRole } from "./role-boards";

type SignInLinkProps = Omit<ComponentProps<typeof Link>, "href">;

export function SignInLink({ children, ...props }: SignInLinkProps): ReactNode {
  const pathname = usePathname() ?? "/";
  const [href, setHref] = useState(() => loginHref(pathname));

  useEffect(() => {
    setHref(loginHref(`${pathname}${window.location.search}${window.location.hash}`));
  }, [pathname]);

  return (
    <Link href={href} {...props}>
      {children}
    </Link>
  );
}

// What a page's `if (!token || !schoolId)` gate really means depends on
// who is looking at it:
// - No token: an anonymous visitor, who legitimately must sign in.
// - A token without schoolId: the session IS signed in — it is the
//   Platform Owner (the only account with no school), for whom every
//   school-scoped page is simply not their workspace. The old gates
//   answered both with "Please sign in", which told a signed-in owner
//   that they were signed out. BUGSFIX 87 is the split.

/** Generic copy for owners hitting an action they cannot perform. */
export function actionSignInMessage(prompt: string, token: string | null, schoolId: string | null): string {
  if (token && !schoolId) {
    return "You are signed in as the Platform Owner — this action needs a school account.";
  }
  return prompt;
}

export function SignInGate({ prompt }: { prompt: string }): ReactNode {
  const { token, schoolId, user } = useAuth();
  const signedInOwner = Boolean(token) && !schoolId && user?.role === "PLATFORM_OWNER";
  return (
    <div style={{ ...cardStyle, maxWidth: 640 }}>
      {signedInOwner ? (
        <>
          <p style={{ ...mutedStyle, margin: "0 0 8px" }}>
            You are signed in as the Platform Owner. This page belongs to a school workspace —
            browse it from a school account, or manage everything from the owner console.
          </p>
          <Link
            href={boardPathForRole("PLATFORM_OWNER")}
            style={{ color: colors.primary, fontWeight: 600, fontSize: 14, textDecoration: "none" }}
          >
            Open owner panel
          </Link>
        </>
      ) : (
        <>
          <p style={{ ...mutedStyle, margin: "0 0 8px" }}>{prompt}</p>
          <SignInLink
            style={{ color: colors.primary, fontWeight: 600, fontSize: 14, textDecoration: "none" }}
          >
            Go to login
          </SignInLink>
        </>
      )}
    </div>
  );
}
