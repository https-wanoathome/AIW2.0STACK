"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

type FormState = { error: string | null };

export async function signIn(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  // signInWithPassword sets the auth cookie. Redirect now.
  redirect("/dashboard");
}
