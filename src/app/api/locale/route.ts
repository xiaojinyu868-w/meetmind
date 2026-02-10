import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { locales, type Locale, defaultLocale } from '@/i18n/config';

export async function POST(request: NextRequest) {
  try {
    const { locale } = await request.json();
    
    // Validate locale
    if (!locale || !locales.includes(locale as Locale)) {
      return NextResponse.json(
        { success: false, error: 'Invalid locale' },
        { status: 400 }
      );
    }
    
    // Set cookie
    const cookieStore = await cookies();
    cookieStore.set('NEXT_LOCALE', locale, {
      maxAge: 365 * 24 * 60 * 60, // 1 year
      path: '/',
    });
    
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to set locale' },
      { status: 500 }
    );
  }
}

export async function GET() {
  const cookieStore = await cookies();
  const locale = cookieStore.get('NEXT_LOCALE')?.value || defaultLocale;
  
  return NextResponse.json({ locale });
}
