-- Account-global AI conversation history. This domain is intentionally separate
-- from classroom-scoped WorkspaceCaptureArtifact evidence.

-- CreateTable
CREATE TABLE "AccountConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global-ask',
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessage" TEXT,
    "model" TEXT,
    "metadataJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sourceMutationId" TEXT NOT NULL,
    "clientCreatedAt" DATETIME NOT NULL,
    "clientUpdatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccountConversationMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachmentsJson" TEXT,
    "sourceMutationId" TEXT NOT NULL,
    "clientCreatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AccountConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AccountConversation_userId_scope_clientUpdatedAt_idx" ON "AccountConversation"("userId", "scope", "clientUpdatedAt");
CREATE INDEX "AccountConversation_userId_status_idx" ON "AccountConversation"("userId", "status");
CREATE INDEX "AccountConversationMessage_conversationId_clientCreatedAt_idx" ON "AccountConversationMessage"("conversationId", "clientCreatedAt");
