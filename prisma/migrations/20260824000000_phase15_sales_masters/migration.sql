CREATE TABLE "customer_group" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_group_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_area" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_area_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_route" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_route_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "salesperson" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "linkedUserId" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "salesperson_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "salesperson_area" (
    "salespersonId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "salesperson_area_pkey" PRIMARY KEY ("salespersonId", "areaId")
);

CREATE TABLE "salesperson_route" (
    "salespersonId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "salesperson_route_pkey" PRIMARY KEY ("salespersonId", "routeId")
);

CREATE TABLE "customer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT NOT NULL,
    "secondaryPhone" TEXT,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT,
    "customerGroupId" TEXT,
    "areaId" TEXT NOT NULL,
    "routeId" TEXT,
    "salespersonId" TEXT,
    "taxRegistrationNo" TEXT,
    "creditLimit" DECIMAL(24,6),
    "paymentTermsDays" INTEGER,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_credit_limit_nonnegative" CHECK ("creditLimit" IS NULL OR "creditLimit" >= 0),
    CONSTRAINT "customer_payment_terms_nonnegative" CHECK ("paymentTermsDays" IS NULL OR "paymentTermsDays" >= 0)
);

CREATE UNIQUE INDEX "customer_group_code_key" ON "customer_group"("code");
CREATE INDEX "customer_group_active_name_idx" ON "customer_group"("active", "name");
CREATE UNIQUE INDEX "sales_area_code_key" ON "sales_area"("code");
CREATE INDEX "sales_area_active_name_idx" ON "sales_area"("active", "name");
CREATE UNIQUE INDEX "sales_route_code_key" ON "sales_route"("code");
CREATE INDEX "sales_route_areaId_active_name_idx" ON "sales_route"("areaId", "active", "name");
CREATE UNIQUE INDEX "salesperson_code_key" ON "salesperson"("code");
CREATE INDEX "salesperson_active_name_idx" ON "salesperson"("active", "name");
CREATE INDEX "salesperson_linkedUserId_idx" ON "salesperson"("linkedUserId");
CREATE INDEX "salesperson_area_areaId_idx" ON "salesperson_area"("areaId");
CREATE INDEX "salesperson_route_routeId_idx" ON "salesperson_route"("routeId");
CREATE UNIQUE INDEX "customer_code_key" ON "customer"("code");
CREATE INDEX "customer_active_name_idx" ON "customer"("active", "name");
CREATE INDEX "customer_customerGroupId_active_idx" ON "customer"("customerGroupId", "active");
CREATE INDEX "customer_areaId_active_idx" ON "customer"("areaId", "active");
CREATE INDEX "customer_salespersonId_active_idx" ON "customer"("salespersonId", "active");

ALTER TABLE "sales_route" ADD CONSTRAINT "sales_route_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "sales_area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salesperson" ADD CONSTRAINT "salesperson_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salesperson_area" ADD CONSTRAINT "salesperson_area_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salesperson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "salesperson_area" ADD CONSTRAINT "salesperson_area_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "sales_area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salesperson_route" ADD CONSTRAINT "salesperson_route_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salesperson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "salesperson_route" ADD CONSTRAINT "salesperson_route_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "sales_route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer" ADD CONSTRAINT "customer_customerGroupId_fkey" FOREIGN KEY ("customerGroupId") REFERENCES "customer_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer" ADD CONSTRAINT "customer_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "sales_area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer" ADD CONSTRAINT "customer_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "sales_route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer" ADD CONSTRAINT "customer_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salesperson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
