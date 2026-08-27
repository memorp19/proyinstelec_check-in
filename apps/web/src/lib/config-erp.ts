import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { configErp } from "../db/schema";

/** Única fila de configuración del ERP. */
const CLAVE = "erp";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Configuración operativa del ERP (fila `config_erp` con clave "erp").
 * Sustituye las listas hardcodeadas del legacy (DIRECTORIO_AREAS_OT,
 * CC_AVISO_OT). Se siembra con seed y se edita directamente en la tabla
 * (o con una pantalla de administración futura).
 */
export interface AreaOT {
  clave: string; // ESTUDIOS_ELECTRICOS
  nombre: string; // Estudios Eléctricos
  correo?: string; // correo del área para avisos de nueva OT
}

export interface ConfigErp {
  areas_ot: AreaOT[];
  /** Correos en copia en todo aviso de nueva OT */
  cc_aviso_ot: string[];
}

export const CONFIG_ERP_DEFAULT: ConfigErp = {
  areas_ot: [
    { clave: "ESTUDIOS_ELECTRICOS", nombre: "Estudios Eléctricos" },
    { clave: "PROTECCIONES", nombre: "Protecciones" },
    { clave: "MANTENIMIENTOS", nombre: "Mantenimientos" },
    { clave: "ADMINISTRACION", nombre: "Administración" },
  ],
  cc_aviso_ot: [],
};

// ── Read / write ──────────────────────────────────────────────────────────────

export async function getConfigErp(): Promise<ConfigErp> {
  const [fila] = await getDb()
    .select()
    .from(configErp)
    .where(eq(configErp.clave, CLAVE))
    .limit(1);
  if (!fila) return CONFIG_ERP_DEFAULT;
  const valor = (fila.valor ?? {}) as Partial<ConfigErp>;
  return {
    areas_ot: valor.areas_ot ?? CONFIG_ERP_DEFAULT.areas_ot,
    cc_aviso_ot: valor.cc_aviso_ot ?? CONFIG_ERP_DEFAULT.cc_aviso_ot,
  };
}

export async function saveConfigErp(config: ConfigErp): Promise<void> {
  await getDb()
    .insert(configErp)
    .values({ clave: CLAVE, valor: config, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: configErp.clave,
      set: { valor: config, updatedAt: new Date() },
    });
}
