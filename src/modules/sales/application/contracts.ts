import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

export type SalesMasterRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SalesAreaRecord = SalesMasterRecord & { routeCount: number };
export type SalesRouteRecord = SalesMasterRecord & { areaId: string; areaName: string };
export type SalespersonRecord = Omit<SalesMasterRecord, "description"> & {
  phone: string | null;
  email: string | null;
  linkedUserId: string | null;
  linkedUserName: string | null;
  notes: string | null;
  areaIds: readonly string[];
  routeIds: readonly string[];
  assignmentSummary: string;
};

export type CustomerRecord = {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string;
  secondaryPhone: string | null;
  email: string | null;
  address: string;
  city: string | null;
  customerGroupId: string | null;
  customerGroupName: string | null;
  areaId: string;
  areaName: string;
  routeId: string | null;
  routeName: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  taxRegistrationNo: string | null;
  creditLimit: string | null;
  paymentTermsDays: number | null;
  notes: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SalesReferenceData = {
  groups: readonly SalesMasterRecord[];
  areas: readonly SalesMasterRecord[];
  routes: readonly SalesRouteRecord[];
  salespersons: readonly SalespersonRecord[];
  users: readonly { id: string; name: string; email: string }[];
};

export type CustomerListQuery = {
  page: number;
  query: string;
  customerGroupId?: string;
  areaId?: string;
  salespersonId?: string;
  active?: boolean;
};

export type PageResult<T> = {
  records: readonly T[];
  page: number;
  pageCount: number;
  total: number;
};

export type SalesMutationResult = { ok: true; id?: string } | { ok: false; message: string };

export interface SalesRepository {
  listCustomerGroups(query: string, page: number): Promise<PageResult<SalesMasterRecord>>;
  listAreas(query: string, page: number): Promise<PageResult<SalesAreaRecord>>;
  listRoutes(query: string, page: number, areaId?: string): Promise<PageResult<SalesRouteRecord>>;
  listSalespersons(query: string, page: number): Promise<PageResult<SalespersonRecord>>;
  listCustomers(query: CustomerListQuery): Promise<PageResult<CustomerRecord>>;
  getCustomer(id: string): Promise<CustomerRecord | null>;
  getCustomerGroup(id: string): Promise<SalesMasterRecord | null>;
  getArea(id: string): Promise<SalesAreaRecord | null>;
  getRoute(id: string): Promise<SalesRouteRecord | null>;
  getSalesperson(id: string): Promise<SalespersonRecord | null>;
  getReferenceData(activeOnly?: boolean): Promise<SalesReferenceData>;
  saveCustomerGroup(input: SalesMasterInput): Promise<string>;
  saveArea(input: SalesMasterInput): Promise<string>;
  saveRoute(input: SalesRouteInput): Promise<string>;
  saveSalesperson(input: SalespersonInput): Promise<string>;
  saveCustomer(input: CustomerInput): Promise<string>;
  setCustomerGroupActive(id: string, active: boolean): Promise<boolean>;
  setAreaActive(id: string, active: boolean): Promise<boolean>;
  setRouteActive(id: string, active: boolean): Promise<boolean>;
  setSalespersonActive(id: string, active: boolean): Promise<boolean>;
  setCustomerActive(id: string, active: boolean): Promise<boolean>;
}

export type SalesMasterInput = {
  id?: string;
  code: string;
  name: string;
  description: string | null;
};
export type SalesRouteInput = SalesMasterInput & { areaId: string };
export type SalespersonInput = {
  id?: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  linkedUserId: string | null;
  notes: string | null;
  areaIds: readonly string[];
  routeIds: readonly string[];
};
export type CustomerInput = Omit<
  CustomerRecord,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "customerGroupName"
  | "areaName"
  | "routeName"
  | "salespersonName"
  | "active"
> & { id?: string };

export class SalesRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesRepositoryError";
  }
}

export function requireSalesManager(actor: ApplicationPrincipal) {
  return actor.active && actor.permissions.includes("sales.manage")
    ? null
    : ({ ok: false, message: "Sales management permission is required." } as const);
}
