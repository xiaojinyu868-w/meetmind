import { NextRequest, NextResponse } from 'next/server';

export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/icons/icon-192x192.svg', request.url), 307);
}
