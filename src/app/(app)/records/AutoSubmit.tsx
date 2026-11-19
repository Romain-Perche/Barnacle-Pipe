"use client";
// Submits the filter form as soon as a select or checkbox changes. [ APPLY ] does the same without JavaScript.
import { useEffect } from "react";

export function AutoSubmit({ formId }: { formId: string }) {
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    const onChange = (e: Event) => {
      if (e.target instanceof HTMLSelectElement || (e.target instanceof HTMLInputElement && e.target.type === "checkbox")) {
        form.requestSubmit();
      }
    };
    form.addEventListener("change", onChange);
    return () => form.removeEventListener("change", onChange);
  }, [formId]);
  return null;
}
