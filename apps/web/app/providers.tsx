"use client";

import { SessionProvider } from "next-auth/react";
import { DemoRoleSwitcher } from "./DemoRoleSwitcher";

export default function Providers({
  children,
  demoMode,
}: {
  children: React.ReactNode;
  demoMode: boolean;
}) {
  return (
    <SessionProvider>
      {children}
      {demoMode && <DemoRoleSwitcher />}
    </SessionProvider>
  );
}
