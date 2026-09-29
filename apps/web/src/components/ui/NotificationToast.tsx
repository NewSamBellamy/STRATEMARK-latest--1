import React from 'react';
import { Check, AlertTriangle, Info, X, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

export type NotificationVariant = 'success' | 'error' | 'warning' | 'info';

interface NotificationToastProps {
  variant?: NotificationVariant;
  title: string;
  description?: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

export function NotificationToast({
  variant = 'info',
  title,
  description,
  onClose,
  className,
}: NotificationToastProps) {
  const config = {
    success: {
      card: 'bg-[#F0FDF4] border-[#DCFCE7] text-emerald-950 dark:bg-[#052814]/95 dark:border-[#134E2B] dark:text-emerald-100',
      title: 'text-emerald-950 dark:text-emerald-100',
      desc: 'text-emerald-800/90 dark:text-emerald-300/80',
      outerIcon: 'bg-[#DCFCE7] dark:bg-[#134E2B]',
      innerIcon: 'bg-[#22C55E] text-white',
      icon: Check,
    },
    error: {
      card: 'bg-[#FEF2F2] border-[#FEE2E2] text-rose-950 dark:bg-[#2D0A0A]/95 dark:border-[#581515] dark:text-rose-100',
      title: 'text-rose-950 dark:text-rose-100',
      desc: 'text-rose-800/90 dark:text-rose-300/80',
      outerIcon: 'bg-[#FEE2E2] dark:bg-[#581515]',
      innerIcon: 'bg-[#EF4444] text-white',
      icon: AlertCircle,
    },
    warning: {
      card: 'bg-[#FFFBEB] border-[#FEF3C7] text-amber-950 dark:bg-[#2B1B07]/95 dark:border-[#532E08] dark:text-amber-100',
      title: 'text-amber-950 dark:text-amber-100',
      desc: 'text-amber-800/90 dark:text-amber-300/80',
      outerIcon: 'bg-[#FEF3C7] dark:bg-[#532E08]',
      innerIcon: 'bg-[#F59E0B] text-white',
      icon: AlertTriangle,
    },
    info: {
      card: 'bg-[#F0F9FF] border-[#E0F2FE] text-sky-950 dark:bg-[#07243C]/95 dark:border-[#0C3B60] dark:text-sky-100',
      title: 'text-sky-950 dark:text-sky-100',
      desc: 'text-sky-800/90 dark:text-sky-300/80',
      outerIcon: 'bg-[#E0F2FE] dark:bg-[#0C3B60]',
      innerIcon: 'bg-[#0EA5E9] text-white',
      icon: Info,
    },
  }[variant];

  const IconComponent = config.icon;

  return (
    <div
      className={cn(
        'flex w-full items-start gap-3.5 rounded-2xl border p-4 shadow-lg backdrop-blur-md transition-all',
        config.card,
        className,
      )}
      role="alert"
    >
      {/* Outer soft circle + inner solid badge matching design */}
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          config.outerIcon,
        )}
      >
        <div
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full shadow-sm',
            config.innerIcon,
          )}
        >
          <IconComponent className="h-3.5 w-3.5 stroke-[2.5]" />
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pt-0.5">
        <h4 className={cn('text-[14px] font-semibold tracking-tight', config.title)}>
          {title}
        </h4>
        {description && (
          <div className={cn('mt-0.5 text-[13px] leading-relaxed', config.desc)}>
            {description}
          </div>
        )}
      </div>

      {/* Close button */}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 -mt-1 rounded-lg p-1.5 opacity-60 transition-opacity hover:opacity-100 focus:outline-none"
          aria-label="Close notification"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
