'use client';

import { useExposeLocalAdaptersForTests } from '@/lib/test-hooks';

export function TestHooksMount() {
  useExposeLocalAdaptersForTests();
  return null;
}
