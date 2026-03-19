-- Add missing WorkspaceCapture.status column for legacy SQLite databases
ALTER TABLE "WorkspaceCapture" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';

-- Restore indexes expected by Prisma schema
CREATE INDEX IF NOT EXISTS "WorkspaceCapture_workspaceId_status_idx" ON "WorkspaceCapture"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "WorkspaceCapture_status_idx" ON "WorkspaceCapture"("status");
