import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div className={cn('rounded-lg border border-warm-200 bg-warm-100 p-6', className)} {...props}>
      {children}
    </div>
  );
}
