'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Globe, Check } from 'lucide-react';
import { locales, localeLabels, type Locale } from '@/i18n/config';

export function LanguageSwitcher() {
  const locale = useLocale();
  const [isPending, setIsPending] = useState(false);

  const switchLocale = async (newLocale: Locale) => {
    if (newLocale === locale) return;
    
    setIsPending(true);
    
    try {
      // Call API to set locale
      const response = await fetch('/api/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: newLocale }),
      });
      
      if (response.ok) {
        // Reload page to apply new locale
        window.location.reload();
      } else {
        console.error('Failed to switch locale');
        setIsPending(false);
      }
    } catch (error) {
      console.error('Error switching locale:', error);
      setIsPending(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          disabled={isPending}
        >
          <Globe className="h-4 w-4" />
          <span className="hidden sm:inline">{localeLabels[locale as Locale]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((l) => (
          <DropdownMenuItem
            key={l}
            onClick={() => switchLocale(l)}
            className="gap-2"
          >
            {locale === l && <Check className="h-4 w-4" />}
            <span className={locale === l ? 'font-medium' : ''}>
              {localeLabels[l]}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
