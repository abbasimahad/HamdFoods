import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type {
  CustomerInput,
  CustomerListQuery,
  CustomerRecord,
  PageResult,
  SalesAreaRecord,
  SalesMasterInput,
  SalesMasterRecord,
  SalesReferenceData,
  SalesRepository,
  SalesRouteInput,
  SalesRouteRecord,
  SalespersonInput,
  SalespersonRecord,
} from "@/modules/sales/application/contracts";
import { SalesRepositoryError } from "@/modules/sales/application/contracts";
import { SALES_PAGE_SIZE } from "@/modules/sales/application/listing";
import { prisma } from "@/server/db/prisma";

const customerInclude = {
  customerGroup: true,
  area: true,
  route: true,
  salesperson: true,
} satisfies Prisma.CustomerInclude;
const salespersonInclude = {
  linkedUser: true,
  areaAssignments: { include: { area: true } },
  routeAssignments: { include: { route: true } },
} satisfies Prisma.SalespersonInclude;
type CustomerRow = Prisma.CustomerGetPayload<{ include: typeof customerInclude }>;
type SalespersonRow = Prisma.SalespersonGetPayload<{ include: typeof salespersonInclude }>;

export class PrismaSalesRepository implements SalesRepository {
  async listCustomerGroups(query: string, page: number) {
    return this.listMaster(prisma.customerGroup as unknown as MasterDelegate, query, page);
  }
  async listAreas(query: string, page: number): Promise<PageResult<SalesAreaRecord>> {
    const where = searchWhere(query);
    const [total, rows] = await Promise.all([
      prisma.salesArea.count({ where }),
      prisma.salesArea.findMany({
        where,
        include: { _count: { select: { routes: true } } },
        orderBy: [{ active: "desc" }, { name: "asc" }],
        skip: offset(page),
        take: SALES_PAGE_SIZE,
      }),
    ]);
    return pageResult(
      rows.map((r) => ({ ...master(r), routeCount: r._count.routes })),
      page,
      total,
    );
  }
  async listRoutes(
    query: string,
    page: number,
    areaId?: string,
  ): Promise<PageResult<SalesRouteRecord>> {
    const where = { ...searchWhere(query), ...(areaId ? { areaId } : {}) };
    const [total, rows] = await prisma.$transaction([
      prisma.salesRoute.count({ where }),
      prisma.salesRoute.findMany({
        where,
        include: { area: true },
        orderBy: [{ active: "desc" }, { name: "asc" }],
        skip: offset(page),
        take: SALES_PAGE_SIZE,
      }),
    ]);
    return pageResult(rows.map(mapRoute), page, total);
  }
  async listSalespersons(query: string, page: number): Promise<PageResult<SalespersonRecord>> {
    const where = query.trim()
      ? {
          OR: [
            { code: { contains: query.trim(), mode: "insensitive" as const } },
            { name: { contains: query.trim(), mode: "insensitive" as const } },
            { phone: { contains: query.trim(), mode: "insensitive" as const } },
          ],
        }
      : {};
    const [total, rows] = await prisma.$transaction([
      prisma.salesperson.count({ where }),
      prisma.salesperson.findMany({
        where,
        include: salespersonInclude,
        orderBy: [{ active: "desc" }, { name: "asc" }],
        skip: offset(page),
        take: SALES_PAGE_SIZE,
      }),
    ]);
    return pageResult(rows.map(mapSalesperson), page, total);
  }
  async listCustomers(query: CustomerListQuery): Promise<PageResult<CustomerRecord>> {
    const term = query.query.trim();
    const where = {
      ...(term
        ? {
            OR: [
              { code: { contains: term, mode: "insensitive" as const } },
              { name: { contains: term, mode: "insensitive" as const } },
              { phone: { contains: term, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(query.customerGroupId ? { customerGroupId: query.customerGroupId } : {}),
      ...(query.areaId ? { areaId: query.areaId } : {}),
      ...(query.salespersonId ? { salespersonId: query.salespersonId } : {}),
      ...(query.active === undefined ? {} : { active: query.active }),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        include: customerInclude,
        orderBy: [{ active: "desc" }, { name: "asc" }],
        skip: offset(query.page),
        take: SALES_PAGE_SIZE,
      }),
    ]);
    return pageResult(rows.map(mapCustomer), query.page, total);
  }
  async getCustomer(id: string) {
    const row = await prisma.customer.findUnique({ where: { id }, include: customerInclude });
    return row ? mapCustomer(row) : null;
  }
  async getCustomerGroup(id: string) {
    const row = await prisma.customerGroup.findUnique({ where: { id } });
    return row ? master(row) : null;
  }
  async getArea(id: string) {
    const row = await prisma.salesArea.findUnique({
      where: { id },
      include: { _count: { select: { routes: true } } },
    });
    return row ? { ...master(row), routeCount: row._count.routes } : null;
  }
  async getRoute(id: string) {
    const row = await prisma.salesRoute.findUnique({ where: { id }, include: { area: true } });
    return row ? mapRoute(row) : null;
  }
  async getSalesperson(id: string) {
    const row = await prisma.salesperson.findUnique({ where: { id }, include: salespersonInclude });
    return row ? mapSalesperson(row) : null;
  }
  async getReferenceData(activeOnly = true): Promise<SalesReferenceData> {
    const active = activeOnly ? { active: true } : {};
    const [groups, areas, routes, salespersons, users] = await Promise.all([
      prisma.customerGroup.findMany({ where: active, orderBy: { name: "asc" } }),
      prisma.salesArea.findMany({ where: active, orderBy: { name: "asc" } }),
      prisma.salesRoute.findMany({
        where: active,
        include: { area: true },
        orderBy: { name: "asc" },
      }),
      prisma.salesperson.findMany({
        where: active,
        include: salespersonInclude,
        orderBy: { name: "asc" },
      }),
      prisma.user.findMany({
        where: activeOnly ? { active: true } : {},
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
        take: 500,
      }),
    ]);
    return {
      groups: groups.map(master),
      areas: areas.map(master),
      routes: routes.map(mapRoute),
      salespersons: salespersons.map(mapSalesperson),
      users,
    };
  }
  async saveCustomerGroup(input: SalesMasterInput) {
    return saveMaster(prisma.customerGroup as unknown as MasterDelegate, input);
  }
  async saveArea(input: SalesMasterInput) {
    return saveMaster(prisma.salesArea as unknown as MasterDelegate, input);
  }
  async saveRoute(input: SalesRouteInput) {
    return transaction(async (tx) => {
      const current = input.id ? await tx.salesRoute.findUnique({ where: { id: input.id } }) : null;
      if (current && current.areaId !== input.areaId) {
        const customerCount = await tx.customer.count({ where: { routeId: current.id } });
        if (customerCount) {
          throw new SalesRepositoryError(
            "A route with customer history cannot be moved to another area.",
          );
        }
      }
      await activeReference(
        tx.salesArea as unknown as ActiveDelegate,
        input.areaId,
        current?.areaId,
      );
      return saveMaster(tx.salesRoute as unknown as MasterDelegate, input);
    });
  }
  async saveSalesperson(input: SalespersonInput) {
    return transaction(async (tx) => {
      if (input.linkedUserId)
        await activeReference(tx.user as unknown as ActiveDelegate, input.linkedUserId);
      await activeMany(tx.salesArea as unknown as ActiveManyDelegate, input.areaIds);
      await activeMany(tx.salesRoute as unknown as ActiveManyDelegate, input.routeIds);
      const routeAreas = input.routeIds.length
        ? await tx.salesRoute.findMany({
            where: { id: { in: [...input.routeIds] } },
            select: { areaId: true },
          })
        : [];
      const areas = new Set(input.areaIds);
      if (routeAreas.some((route) => !areas.has(route.areaId)))
        throw new SalesRepositoryError(
          "Each assigned route must have its area assigned to the salesperson.",
        );
      const data = {
        code: input.code,
        name: input.name,
        phone: input.phone,
        email: input.email,
        linkedUserId: input.linkedUserId,
        notes: input.notes,
        areaAssignments: { deleteMany: {}, create: input.areaIds.map((areaId) => ({ areaId })) },
        routeAssignments: {
          deleteMany: {},
          create: input.routeIds.map((routeId) => ({ routeId })),
        },
      };
      try {
        return input.id
          ? (await tx.salesperson.update({ where: { id: input.id }, data })).id
          : (await tx.salesperson.create({ data })).id;
      } catch (error) {
        throw mapped(error, "salesperson");
      }
    });
  }
  async saveCustomer(input: CustomerInput) {
    return transaction(async (tx) => {
      const current = input.id ? await tx.customer.findUnique({ where: { id: input.id } }) : null;
      await activeReference(
        tx.salesArea as unknown as ActiveDelegate,
        input.areaId,
        current?.areaId,
      );
      if (input.customerGroupId)
        await activeReference(
          tx.customerGroup as unknown as ActiveDelegate,
          input.customerGroupId,
          current?.customerGroupId ?? undefined,
        );
      if (input.salespersonId)
        await activeReference(
          tx.salesperson as unknown as ActiveDelegate,
          input.salespersonId,
          current?.salespersonId ?? undefined,
        );
      if (input.routeId) {
        const route = await tx.salesRoute.findUnique({ where: { id: input.routeId } });
        if (!route || (route.id !== current?.routeId && !route.active))
          throw new SalesRepositoryError("Select an active route.");
        if (route.areaId !== input.areaId)
          throw new SalesRepositoryError("The selected route must belong to the selected area.");
      }
      const data = {
        code: input.code,
        name: input.name,
        contactPerson: input.contactPerson,
        phone: input.phone,
        secondaryPhone: input.secondaryPhone,
        email: input.email,
        address: input.address,
        city: input.city,
        customerGroupId: input.customerGroupId,
        areaId: input.areaId,
        routeId: input.routeId,
        salespersonId: input.salespersonId,
        taxRegistrationNo: input.taxRegistrationNo,
        creditLimit: input.creditLimit,
        paymentTermsDays: input.paymentTermsDays,
        notes: input.notes,
      };
      try {
        return input.id
          ? (await tx.customer.update({ where: { id: input.id }, data })).id
          : (await tx.customer.create({ data })).id;
      } catch (error) {
        throw mapped(error, "customer");
      }
    });
  }
  async setCustomerGroupActive(id: string, active: boolean) {
    return status(prisma.customerGroup as unknown as StatusDelegate, id, active);
  }
  async setAreaActive(id: string, active: boolean) {
    return status(prisma.salesArea as unknown as StatusDelegate, id, active);
  }
  async setRouteActive(id: string, active: boolean) {
    return status(prisma.salesRoute as unknown as StatusDelegate, id, active);
  }
  async setSalespersonActive(id: string, active: boolean) {
    return status(prisma.salesperson as unknown as StatusDelegate, id, active);
  }
  async setCustomerActive(id: string, active: boolean) {
    return status(prisma.customer as unknown as StatusDelegate, id, active);
  }
  private async listMaster(
    model: MasterDelegate,
    query: string,
    page: number,
  ): Promise<PageResult<SalesMasterRecord>> {
    const where = searchWhere(query);
    const [total, rows] = await Promise.all([
      model.count({ where }),
      model.findMany({
        where,
        orderBy: [{ active: "desc" }, { name: "asc" }],
        skip: offset(page),
        take: SALES_PAGE_SIZE,
      }),
    ]);
    return pageResult(rows.map(master), page, total);
  }
}

function master(row: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SalesMasterRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
function mapRoute(row: Prisma.SalesRouteGetPayload<{ include: { area: true } }>): SalesRouteRecord {
  return { ...master(row), areaId: row.areaId, areaName: row.area.name };
}
function mapSalesperson(row: SalespersonRow): SalespersonRecord {
  const areas = row.areaAssignments.map((x) => x.area.name);
  const routes = row.routeAssignments.map((x) => x.route.name);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone,
    email: row.email,
    linkedUserId: row.linkedUserId,
    linkedUserName: row.linkedUser?.name ?? null,
    notes: row.notes,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    areaIds: row.areaAssignments.map((x) => x.areaId),
    routeIds: row.routeAssignments.map((x) => x.routeId),
    assignmentSummary: [...areas, ...routes].join(" · ") || "-",
  };
}
function mapCustomer(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    contactPerson: row.contactPerson,
    phone: row.phone,
    secondaryPhone: row.secondaryPhone,
    email: row.email,
    address: row.address,
    city: row.city,
    customerGroupId: row.customerGroupId,
    customerGroupName: row.customerGroup?.name ?? null,
    areaId: row.areaId,
    areaName: row.area.name,
    routeId: row.routeId,
    routeName: row.route?.name ?? null,
    salespersonId: row.salespersonId,
    salespersonName: row.salesperson?.name ?? null,
    taxRegistrationNo: row.taxRegistrationNo,
    creditLimit: row.creditLimit?.toString() ?? null,
    paymentTermsDays: row.paymentTermsDays,
    notes: row.notes,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
function searchWhere(query: string) {
  const term = query.trim();
  return term
    ? {
        OR: [
          { code: { contains: term, mode: "insensitive" as const } },
          { name: { contains: term, mode: "insensitive" as const } },
        ],
      }
    : {};
}
function pageResult<T>(records: readonly T[], page: number, total: number): PageResult<T> {
  return { records, page, total, pageCount: Math.max(1, Math.ceil(total / SALES_PAGE_SIZE)) };
}
function offset(page: number) {
  return (page - 1) * SALES_PAGE_SIZE;
}
type MasterRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};
type MasterDelegate = {
  count: (args: { where: ReturnType<typeof searchWhere> }) => Promise<number>;
  findMany: (args: {
    where: ReturnType<typeof searchWhere>;
    orderBy: ({ active: "desc" } | { name: "asc" })[];
    skip: number;
    take: number;
  }) => Promise<readonly MasterRow[]>;
  create: (args: {
    data: Pick<MasterRow, "code" | "name" | "description">;
  }) => Promise<{ id: string }>;
  update: (args: {
    where: { id: string };
    data: Pick<MasterRow, "code" | "name" | "description">;
  }) => Promise<{ id: string }>;
};
type StatusDelegate = {
  updateMany: (args: {
    where: { id: string };
    data: { active: boolean };
  }) => Promise<{ count: number }>;
};
type ActiveRow = { id: string; active: boolean };
type ActiveDelegate = {
  findUnique: (args: {
    where: { id: string };
    select: { id: true; active: true };
  }) => Promise<ActiveRow | null>;
};
type ActiveManyDelegate = {
  count: (args: { where: { id: { in: string[] }; active: true } }) => Promise<number>;
};
async function saveMaster(model: MasterDelegate, input: SalesMasterInput) {
  try {
    return input.id
      ? (
          await model.update({
            where: { id: input.id },
            data: { code: input.code, name: input.name, description: input.description },
          })
        ).id
      : (
          await model.create({
            data: { code: input.code, name: input.name, description: input.description },
          })
        ).id;
  } catch (error) {
    throw mapped(error, "record");
  }
}
async function status(model: StatusDelegate, id: string, active: boolean) {
  return (await model.updateMany({ where: { id }, data: { active } })).count === 1;
}
async function activeReference(model: ActiveDelegate, id: string, preservedId?: string) {
  const row = await model.findUnique({ where: { id }, select: { id: true, active: true } });
  if (!row || (!row.active && row.id !== preservedId))
    throw new SalesRepositoryError("Select an active related record.");
}
async function activeMany(model: ActiveManyDelegate, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const count = await model.count({ where: { id: { in: unique }, active: true } });
  if (count !== unique.length)
    throw new SalesRepositoryError("Assignments must reference active records.");
}
async function transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(operation, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}
function mapped(error: unknown, entity: string) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    return new SalesRepositoryError(`A ${entity} with that code already exists.`);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025")
    return new SalesRepositoryError("Record no longer exists.");
  return error instanceof Error
    ? error
    : new SalesRepositoryError(`The ${entity} could not be saved.`);
}
