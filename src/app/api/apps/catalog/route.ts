import { NextResponse } from 'next/server';
import { appPluginRegistry, WORKSHOP_APP_CATALOG } from '@/lib/ai-native';

export async function GET() {
  const pluginIds = new Set(appPluginRegistry.list().map((plugin) => plugin.id));
  const apps = WORKSHOP_APP_CATALOG.map((item) => ({
    ...item,
    enabled: pluginIds.has(item.pluginId),
  }));

  return NextResponse.json({
    apps,
    count: apps.length,
  });
}

