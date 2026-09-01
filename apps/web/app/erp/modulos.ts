import type { Permiso } from "@/src/lib/permisos";

/**
 * Módulos del ERP: qué permiso abre cada uno y en qué fase se libera.
 * Única fuente para el menú lateral y la portada de /erp.
 */
export interface ModuloErp {
  key: string;
  titulo: string;
  descripcion: string;
  href: string;
  permiso: Permiso;
  fase: 1 | 2 | 3 | 4;
  disponible: boolean;
}

export const MODULOS_ERP: ModuloErp[] = [
  {
    key: "cotizaciones",
    titulo: "Cotizaciones",
    descripcion: "Crear, versionar, revisar y enviar cotizaciones; ingreso de OC",
    href: "/erp/cotizaciones",
    permiso: "modulo.cotizaciones",
    fase: 1,
    disponible: true,
  },
  {
    key: "clientes",
    titulo: "Clientes",
    descripcion: "Empresas y contactos",
    href: "/erp/clientes",
    permiso: "modulo.clientes",
    fase: 1,
    disponible: true,
  },
  {
    key: "ot",
    titulo: "Órdenes de Trabajo",
    descripcion: "Ficha de OT, responsables y documentos",
    href: "/erp/ot",
    permiso: "modulo.ot",
    fase: 2,
    disponible: false,
  },
  {
    key: "control-operativo",
    titulo: "Control Operativo",
    descripcion: "Pendientes, servicios y cobertura por OT",
    href: "/erp/control-operativo",
    permiso: "modulo.control.operativo",
    fase: 2,
    disponible: false,
  },
  {
    key: "weekly",
    titulo: "Weekly",
    descripcion: "Actividades de la semana, seguimiento y solicitudes",
    href: "/erp/weekly",
    permiso: "modulo.weekly",
    fase: 3,
    disponible: false,
  },
  {
    key: "kpi",
    titulo: "KPIs",
    descripcion: "Plantillas, asignaciones y evaluaciones",
    href: "/erp/kpi",
    permiso: "modulo.kpi",
    fase: 4,
    disponible: false,
  },
];
