import type { ReactNode } from 'react'

/**
 * 一套 24×24、stroke 1.75 的线性图标（Lucide 画法），统一描边宽度与圆角。
 * 一律 aria-hidden：图标只是文字标签的视觉补充，读屏读文字就够了，
 * 也保证按钮的可访问名仍然只有中文标签。
 */
function Icon({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ?? 'h-3.5 w-3.5'}
    >
      {children}
    </svg>
  )
}

export function DownloadIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className === undefined ? {} : { className })}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </Icon>
  )
}

export function UploadIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className === undefined ? {} : { className })}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </Icon>
  )
}

export function FileIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className === undefined ? {} : { className })}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </Icon>
  )
}

export function FolderIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className === undefined ? {} : { className })}>
      <path d="M4 20a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2z" />
    </Icon>
  )
}

export function LinkIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className === undefined ? {} : { className })}>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </Icon>
  )
}

export function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className === undefined ? {} : { className })}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </Icon>
  )
}

export function AlertIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className === undefined ? {} : { className })}>
      <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Icon>
  )
}

export function SettingsIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className === undefined ? {} : { className })}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Icon>
  )
}

export function ActivityIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className === undefined ? {} : { className })}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </Icon>
  )
}

export function PencilIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className === undefined ? {} : { className })}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Icon>
  )
}

export function TrashIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className === undefined ? {} : { className })}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </Icon>
  )
}

export function SaveIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className === undefined ? {} : { className })}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </Icon>
  )
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className === undefined ? {} : { className })}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  )
}

export function PlusIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className === undefined ? {} : { className })}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  )
}

export function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <Icon {...(className === undefined ? {} : { className })}>
      <path d="m15 18-6-6 6-6" />
    </Icon>
  )
}
