import type * as React from 'react'
import {
  buttonSizeMd,
  buttonSizeSm,
  dangerButton,
  primaryButton,
  secondaryButton,
  segmentActive,
  segmentButton,
  segmentTrack,
  stickyActionBar,
} from './buttonStyles'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: 'sm' | 'md' }

const sizeClass = (size: 'sm' | 'md'): string => (size === 'sm' ? buttonSizeSm : buttonSizeMd)

export function PrimaryButton({ className = '', size = 'md', ...props }: ButtonProps): React.JSX.Element {
  return <button className={`${primaryButton} ${sizeClass(size)} ${className}`} {...props} />
}

export function SecondaryButton({ className = '', size = 'md', ...props }: ButtonProps): React.JSX.Element {
  return <button className={`${secondaryButton} ${sizeClass(size)} ${className}`} {...props} />
}

export function DangerButton({ className = '', size = 'md', ...props }: ButtonProps): React.JSX.Element {
  return <button className={`${dangerButton} ${sizeClass(size)} ${className}`} {...props} />
}

type SegmentedChoiceProps<T extends string> = {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  disabled?: boolean
  onChange: (value: T) => void
}

export function SegmentedChoice<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: SegmentedChoiceProps<T>): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className={segmentTrack}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          className={`${segmentButton} ${value === option.value ? segmentActive : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function StickyActionBar({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className={stickyActionBar}>{children}</div>
}
