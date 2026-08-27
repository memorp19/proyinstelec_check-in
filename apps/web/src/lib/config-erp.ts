import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient } from "./dynamo-client";

const TABLE = () => process.env.MAIN_TABLE ?? "proyinstelec-main";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Configuración operativa del ERP (ítem CONFIG#erp / #METADATA).
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
  const result = await getDocClient().send(
    new GetCommand({ TableName: TABLE(), Key: { pk: "CONFIG#erp", sk: "#METADATA" } }),
  );
  if (!result.Item) return CONFIG_ERP_DEFAULT;
  const item = result.Item as Partial<ConfigErp>;
  return {
    areas_ot: item.areas_ot ?? CONFIG_ERP_DEFAULT.areas_ot,
    cc_aviso_ot: item.cc_aviso_ot ?? CONFIG_ERP_DEFAULT.cc_aviso_ot,
  };
}

export async function saveConfigErp(config: ConfigErp): Promise<void> {
  await getDocClient().send(
    new PutCommand({
      TableName: TABLE(),
      Item: { pk: "CONFIG#erp", sk: "#METADATA", ...config, updated_at: new Date().toISOString() },
    }),
  );
}
