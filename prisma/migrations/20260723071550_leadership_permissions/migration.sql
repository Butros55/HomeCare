-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "defaultEmployeePermissions" JSONB,
ADD COLUMN     "defaultLeadershipPermissions" JSONB;

-- AlterTable
ALTER TABLE "OrganizationMembership" ADD COLUMN     "permissions" JSONB;
