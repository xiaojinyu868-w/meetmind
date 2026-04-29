import { NextResponse } from 'next/server';
import { appPluginRegistry } from '@/lib/ai-native';

export async function GET() {
  const plugins = appPluginRegistry.list();
  return NextResponse.json({
    plugins,
    count: plugins.length,
  });
}
