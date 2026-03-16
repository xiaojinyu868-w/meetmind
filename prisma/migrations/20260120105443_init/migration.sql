-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "nickname" TEXT NOT NULL,
    "avatar" TEXT,
    "role" TEXT NOT NULL DEFAULT 'student',
    "status" TEXT NOT NULL DEFAULT 'active',
    "passwordHash" TEXT,
    "salt" TEXT,
    "defaultWorkspaceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME,
    CONSTRAINT "User_defaultWorkspaceId_fkey" FOREIGN KEY ("defaultWorkspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AuthProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'personal',
    "status" TEXT NOT NULL DEFAULT 'active',
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkspaceMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkspaceMembership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkspaceCapture" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "role" TEXT NOT NULL DEFAULT 'support',
    "contentType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "previewText" TEXT,
    "normalizedText" TEXT,
    "sourceUrl" TEXT,
    "mediaUrl" TEXT,
    "metadataJson" TEXT,
    "tutorContext" TEXT,
    "occurredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkspaceCapture_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceCapture_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkspaceEcho" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "captureId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "kind" TEXT,
    "generatedDateKey" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "chipsJson" TEXT,
    "metadataJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkspaceEcho_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceEcho_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "WorkspaceCapture" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstAttempt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" DATETIME
);

-- CreateTable
CREATE TABLE "CsrfToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "target" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contact" TEXT,
    "userId" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "adminNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ApiUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "quotaType" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserAnalytics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "sessionToken" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "entryPage" TEXT,
    "exitPage" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "isNewUser" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "PageView" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analyticsId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "visitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "referrer" TEXT,
    CONSTRAINT "PageView_analyticsId_fkey" FOREIGN KEY ("analyticsId") REFERENCES "UserAnalytics" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analyticsId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventCategory" TEXT,
    "eventData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventTrack_analyticsId_fkey" FOREIGN KEY ("analyticsId") REFERENCES "UserAnalytics" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WechatInboxMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "linkToken" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "userId" TEXT,
    "workspaceId" TEXT,
    "developerId" TEXT,
    "msgType" TEXT NOT NULL,
    "eventType" TEXT,
    "messageId" TEXT,
    "messageAt" DATETIME,
    "rawXml" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "normalizedText" TEXT,
    "previewText" TEXT,
    "sourceUrl" TEXT,
    "mediaId" TEXT,
    "mediaUrl" TEXT,
    "title" TEXT,
    "reachKind" TEXT,
    "reachChannel" TEXT,
    "collectionRole" TEXT,
    "bindingStatus" TEXT NOT NULL DEFAULT 'unresolved',
    "echoTitle" TEXT,
    "echoBody" TEXT,
    "echoChipsJson" TEXT,
    "tutorContext" TEXT,
    "replyText" TEXT,
    "processedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'received',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WechatInboxMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WechatInboxMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_defaultWorkspaceId_idx" ON "User"("defaultWorkspaceId");

-- CreateIndex
CREATE INDEX "AuthProvider_userId_idx" ON "AuthProvider"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthProvider_provider_providerId_key" ON "AuthProvider"("provider", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Workspace_ownerId_idx" ON "Workspace"("ownerId");

-- CreateIndex
CREATE INDEX "Workspace_kind_idx" ON "Workspace"("kind");

-- CreateIndex
CREATE INDEX "Workspace_status_idx" ON "Workspace"("status");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_userId_idx" ON "WorkspaceMembership"("userId");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_workspaceId_idx" ON "WorkspaceMembership"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_role_idx" ON "WorkspaceMembership"("role");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMembership_workspaceId_userId_key" ON "WorkspaceMembership"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceCapture_sourceKey_key" ON "WorkspaceCapture"("sourceKey");

-- CreateIndex
CREATE INDEX "WorkspaceCapture_workspaceId_idx" ON "WorkspaceCapture"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceCapture_workspaceId_status_idx" ON "WorkspaceCapture"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "WorkspaceCapture_userId_idx" ON "WorkspaceCapture"("userId");

-- CreateIndex
CREATE INDEX "WorkspaceCapture_status_idx" ON "WorkspaceCapture"("status");

-- CreateIndex
CREATE INDEX "WorkspaceCapture_role_idx" ON "WorkspaceCapture"("role");

-- CreateIndex
CREATE INDEX "WorkspaceCapture_contentType_idx" ON "WorkspaceCapture"("contentType");

-- CreateIndex
CREATE INDEX "WorkspaceCapture_createdAt_idx" ON "WorkspaceCapture"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceEcho_sourceKey_key" ON "WorkspaceEcho"("sourceKey");

-- CreateIndex
CREATE INDEX "WorkspaceEcho_workspaceId_idx" ON "WorkspaceEcho"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceEcho_captureId_idx" ON "WorkspaceEcho"("captureId");

-- CreateIndex
CREATE INDEX "WorkspaceEcho_kind_idx" ON "WorkspaceEcho"("kind");

-- CreateIndex
CREATE INDEX "WorkspaceEcho_status_idx" ON "WorkspaceEcho"("status");

-- CreateIndex
CREATE INDEX "WorkspaceEcho_generatedDateKey_idx" ON "WorkspaceEcho"("generatedDateKey");

-- CreateIndex
CREATE INDEX "WorkspaceEcho_workspaceId_kind_generatedDateKey_idx" ON "WorkspaceEcho"("workspaceId", "kind", "generatedDateKey");

-- CreateIndex
CREATE INDEX "WorkspaceEcho_createdAt_idx" ON "WorkspaceEcho"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_token_idx" ON "Session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_token_idx" ON "RefreshToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "LoginAttempt_identifier_key" ON "LoginAttempt"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "CsrfToken_token_key" ON "CsrfToken"("token");

-- CreateIndex
CREATE INDEX "CsrfToken_token_idx" ON "CsrfToken"("token");

-- CreateIndex
CREATE INDEX "VerificationCode_target_type_purpose_idx" ON "VerificationCode"("target", "type", "purpose");

-- CreateIndex
CREATE INDEX "VerificationCode_code_idx" ON "VerificationCode"("code");

-- CreateIndex
CREATE INDEX "Feedback_type_idx" ON "Feedback"("type");

-- CreateIndex
CREATE INDEX "Feedback_status_idx" ON "Feedback"("status");

-- CreateIndex
CREATE INDEX "Feedback_userId_idx" ON "Feedback"("userId");

-- CreateIndex
CREATE INDEX "ApiUsage_userId_idx" ON "ApiUsage"("userId");

-- CreateIndex
CREATE INDEX "ApiUsage_quotaType_idx" ON "ApiUsage"("quotaType");

-- CreateIndex
CREATE INDEX "ApiUsage_date_idx" ON "ApiUsage"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ApiUsage_userId_quotaType_date_key" ON "ApiUsage"("userId", "quotaType", "date");

-- CreateIndex
CREATE UNIQUE INDEX "UserAnalytics_sessionToken_key" ON "UserAnalytics"("sessionToken");

-- CreateIndex
CREATE INDEX "UserAnalytics_userId_idx" ON "UserAnalytics"("userId");

-- CreateIndex
CREATE INDEX "UserAnalytics_startedAt_idx" ON "UserAnalytics"("startedAt");

-- CreateIndex
CREATE INDEX "UserAnalytics_ip_idx" ON "UserAnalytics"("ip");

-- CreateIndex
CREATE INDEX "UserAnalytics_isNewUser_idx" ON "UserAnalytics"("isNewUser");

-- CreateIndex
CREATE INDEX "PageView_analyticsId_idx" ON "PageView"("analyticsId");

-- CreateIndex
CREATE INDEX "PageView_path_idx" ON "PageView"("path");

-- CreateIndex
CREATE INDEX "PageView_visitedAt_idx" ON "PageView"("visitedAt");

-- CreateIndex
CREATE INDEX "EventTrack_analyticsId_idx" ON "EventTrack"("analyticsId");

-- CreateIndex
CREATE INDEX "EventTrack_eventName_idx" ON "EventTrack"("eventName");

-- CreateIndex
CREATE INDEX "EventTrack_eventCategory_idx" ON "EventTrack"("eventCategory");

-- CreateIndex
CREATE INDEX "EventTrack_createdAt_idx" ON "EventTrack"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WechatInboxMessage_linkToken_key" ON "WechatInboxMessage"("linkToken");

-- CreateIndex
CREATE UNIQUE INDEX "WechatInboxMessage_messageId_key" ON "WechatInboxMessage"("messageId");

-- CreateIndex
CREATE INDEX "WechatInboxMessage_openId_idx" ON "WechatInboxMessage"("openId");

-- CreateIndex
CREATE INDEX "WechatInboxMessage_userId_idx" ON "WechatInboxMessage"("userId");

-- CreateIndex
CREATE INDEX "WechatInboxMessage_workspaceId_idx" ON "WechatInboxMessage"("workspaceId");

-- CreateIndex
CREATE INDEX "WechatInboxMessage_msgType_idx" ON "WechatInboxMessage"("msgType");

-- CreateIndex
CREATE INDEX "WechatInboxMessage_eventType_idx" ON "WechatInboxMessage"("eventType");

-- CreateIndex
CREATE INDEX "WechatInboxMessage_bindingStatus_idx" ON "WechatInboxMessage"("bindingStatus");

-- CreateIndex
CREATE INDEX "WechatInboxMessage_reachChannel_idx" ON "WechatInboxMessage"("reachChannel");

-- CreateIndex
CREATE INDEX "WechatInboxMessage_createdAt_idx" ON "WechatInboxMessage"("createdAt");
