"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Signed-in operators land on the floor, not the marketing page (design §4.12). */
export function FloorRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      router.replace("/floor");
    }
  }, [isLoaded, isSignedIn, router]);
  return null;
}
