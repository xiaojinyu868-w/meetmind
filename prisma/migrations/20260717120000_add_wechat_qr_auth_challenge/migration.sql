-- CreateTable
CREATE TABLE "WechatOauthState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "state" TEXT NOT NULL,
    "linkToken" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WechatQrAuthChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scene" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "browserTokenHash" TEXT NOT NULL,
    "targetUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "imageUrl" TEXT NOT NULL,
    "openId" TEXT,
    "resultUserId" TEXT,
    "error" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "scannedAt" DATETIME,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "WechatOauthState_state_key" ON "WechatOauthState"("state");

-- CreateIndex
CREATE INDEX "WechatOauthState_expiresAt_idx" ON "WechatOauthState"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WechatQrAuthChallenge_scene_key" ON "WechatQrAuthChallenge"("scene");

-- CreateIndex
CREATE INDEX "WechatQrAuthChallenge_status_idx" ON "WechatQrAuthChallenge"("status");

-- CreateIndex
CREATE INDEX "WechatQrAuthChallenge_expiresAt_idx" ON "WechatQrAuthChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "WechatQrAuthChallenge_targetUserId_idx" ON "WechatQrAuthChallenge"("targetUserId");

-- CreateIndex
CREATE INDEX "WechatQrAuthChallenge_reuse_idx" ON "WechatQrAuthChallenge"("browserTokenHash", "mode", "targetUserId", "status", "expiresAt");
