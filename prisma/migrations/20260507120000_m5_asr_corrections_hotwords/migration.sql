-- M5 T5.1: ASR correction feedback loop
-- AsrCorrection stores each user edit from the transcript; aggregateHotwords()
-- rolls repeats into AsrHotword which feeds buildASRContextHint.

-- CreateTable
CREATE TABLE "AsrCorrection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "workspaceId" TEXT,
    "sessionId" TEXT NOT NULL,
    "wrongText" TEXT NOT NULL,
    "correctedText" TEXT NOT NULL,
    "beginMs" INTEGER,
    "endMs" INTEGER,
    "context" TEXT,
    "asrMode" TEXT NOT NULL DEFAULT 'unknown',
    "aggregated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AsrCorrection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AsrCorrection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AsrHotword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "workspaceId" TEXT,
    "term" TEXT NOT NULL,
    "aliases" TEXT,
    "weight" REAL NOT NULL DEFAULT 1.0,
    "source" TEXT NOT NULL DEFAULT 'correction',
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AsrHotword_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AsrHotword_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AsrCorrection_userId_idx" ON "AsrCorrection"("userId");
CREATE INDEX "AsrCorrection_workspaceId_idx" ON "AsrCorrection"("workspaceId");
CREATE INDEX "AsrCorrection_sessionId_idx" ON "AsrCorrection"("sessionId");
CREATE INDEX "AsrCorrection_aggregated_idx" ON "AsrCorrection"("aggregated");
CREATE INDEX "AsrCorrection_createdAt_idx" ON "AsrCorrection"("createdAt");

CREATE UNIQUE INDEX "AsrHotword_userId_term_key" ON "AsrHotword"("userId", "term");
CREATE UNIQUE INDEX "AsrHotword_workspaceId_term_key" ON "AsrHotword"("workspaceId", "term");
CREATE INDEX "AsrHotword_userId_idx" ON "AsrHotword"("userId");
CREATE INDEX "AsrHotword_workspaceId_idx" ON "AsrHotword"("workspaceId");
CREATE INDEX "AsrHotword_weight_idx" ON "AsrHotword"("weight");
