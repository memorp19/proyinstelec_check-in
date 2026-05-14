"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

interface Props {
  nombreInicial: string;
  pendingToken?: string;
}

interface FormState {
  nombre: string;
  telefono: string;
  id_oficial: string;
  contacto_nombre: string;
  contacto_telefono: string;
  terminos: boolean;
}

const MX_PHONE_RE = /^(\+52\s?)?(\d{2,3}[\s-]?)?\d{3,4}[\s-]?\d{4}$/;

function validate(f: FormState): Partial<Record<keyof FormState, string>> {
  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!f.nombre.trim()) errors.nombre = "El nombre es obligatorio.";
  if (!MX_PHONE_RE.test(f.telefono.trim()))
    errors.telefono = "Ingresa un teléfono válido (ej. 55 1234 5678).";
  if (!f.id_oficial.trim()) errors.id_oficial = "La identificación oficial es obligatoria.";
  if (!f.contacto_nombre.trim())
    errors.contacto_nombre = "El nombre del contacto de emergencia es obligatorio.";
  if (!MX_PHONE_RE.test(f.contacto_telefono.trim()))
    errors.contacto_telefono = "Ingresa un teléfono válido para el contacto.";
  if (!f.terminos) errors.terminos = "Debes aceptar los términos para continuar.";
  return errors;
}

export function CompletarPerfilForm({ nombreInicial, pendingToken }: Props) {
  const router = useRouter();
  const { update } = useSession();
  const [form, setForm] = useState<FormState>({
    nombre: nombreInicial,
    telefono: "",
    id_oficial: "",
    contacto_nombre: "",
    contacto_telefono: "",
    terminos: false,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (field: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) =>
    setForm((prev) => ({
      ...prev,
      [field]: field === "terminos" ? e.target.checked : e.target.value,
    }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate(form);
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setServerError(null);
    setSaving(true);

    try {
      const res = await fetch("/api/perfil/completar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.nombre.trim(),
          telefono: form.telefono.trim(),
          id_oficial: form.id_oficial.trim(),
          contacto_emergencia: {
            nombre: form.contacto_nombre.trim(),
            telefono: form.contacto_telefono.trim(),
          },
          pending_token: pendingToken,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Error al guardar el perfil.");
      }

      // Refresh the JWT so middleware sees perfil_completo = true before navigating
      await update();
      router.push("/app");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Error inesperado.");
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm bg-white/5 border border-white/10 rounded-xl p-6 space-y-4"
    >
      <Field
        label="Nombre completo"
        id="nombre"
        value={form.nombre}
        onChange={set("nombre")}
        error={errors.nombre}
        autoComplete="name"
      />

      <Field
        label="Teléfono (México)"
        id="telefono"
        type="tel"
        value={form.telefono}
        onChange={set("telefono")}
        error={errors.telefono}
        placeholder="55 1234 5678"
        autoComplete="tel"
        inputMode="tel"
      />

      <Field
        label="No. de identificación oficial (INE / Pasaporte)"
        id="id_oficial"
        value={form.id_oficial}
        onChange={set("id_oficial")}
        error={errors.id_oficial}
      />

      <p className="font-mono text-xs text-white/50 uppercase tracking-wider pt-1">
        Contacto de emergencia
      </p>

      <Field
        label="Nombre"
        id="contacto_nombre"
        value={form.contacto_nombre}
        onChange={set("contacto_nombre")}
        error={errors.contacto_nombre}
        autoComplete="off"
      />

      <Field
        label="Teléfono"
        id="contacto_telefono"
        type="tel"
        value={form.contacto_telefono}
        onChange={set("contacto_telefono")}
        error={errors.contacto_telefono}
        placeholder="55 1234 5678"
        inputMode="tel"
      />

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          id="terminos"
          checked={form.terminos}
          onChange={set("terminos")}
          className="mt-0.5 w-4 h-4 accent-blue rounded"
        />
        <span className="font-mono text-xs text-white/60 leading-relaxed">
          Acepto el uso de mis datos de geolocalización y fotografías para el
          registro de asistencia conforme a la política de privacidad de
          Proyinstelec.
        </span>
      </label>
      {errors.terminos && (
        <p className="font-mono text-xs text-danger">{errors.terminos}</p>
      )}

      {serverError && (
        <p className="font-mono text-xs text-danger bg-red-900/20 border border-danger/30 rounded-lg px-3 py-2">
          {serverError}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="w-full min-h-[44px] bg-blue disabled:bg-blue/50 text-white
                   font-head text-base font-bold rounded-xl
                   flex items-center justify-center transition-colors"
      >
        {saving ? "Guardando…" : "Completar registro"}
      </button>
    </form>
  );
}

interface FieldProps {
  label: string;
  id: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}

function Field({
  label,
  id,
  value,
  onChange,
  error,
  type = "text",
  placeholder,
  autoComplete,
  inputMode,
}: FieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="font-mono text-xs text-white/50 block">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5
                   font-body text-sm text-white placeholder:text-white/30
                   focus:outline-none focus:ring-1 focus:ring-blue"
      />
      {error && <p className="font-mono text-xs text-danger">{error}</p>}
    </div>
  );
}
