import { useLayoutEffect, useRef } from 'react'
import { css } from '../../../styled-system/css'
import { Button, type ButtonProps } from './button'
import { Tooltip } from './tooltip'

type IconButtonProps = ButtonProps & { tooltip: string }

const tooltipTrigger = css({
  display: 'inline-flex',
  '& > button:disabled': { pointerEvents: 'none' },
})

function IconButton({ tooltip, 'aria-label': ariaLabel, disabled, onBlur, onFocus, size = 'icon-sm', variant = 'plain', ...props }: IconButtonProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const buttonHadFocus = useRef(false)

  useLayoutEffect(() => {
    if (!disabled || !buttonHadFocus.current) return
    triggerRef.current?.focus()
    buttonHadFocus.current = false
  }, [disabled])

  const button = <Button
    aria-label={ariaLabel ?? tooltip}
    disabled={disabled}
    size={size}
    variant={variant}
    onBlur={(event) => { if (!disabled) buttonHadFocus.current = false; onBlur?.(event) }}
    onFocus={(event) => { buttonHadFocus.current = true; onFocus?.(event) }}
    {...props}
  />

  return <Tooltip.Root closeDelay={80} openDelay={350} positioning={{ placement: 'bottom' }}>
    <Tooltip.Trigger asChild><span ref={triggerRef} aria-disabled={disabled ? 'true' : undefined} aria-label={disabled ? ariaLabel ?? tooltip : undefined} className={tooltipTrigger} role={disabled ? 'group' : undefined} tabIndex={disabled ? 0 : undefined}>{button}</span></Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Positioner><Tooltip.Content><Tooltip.Arrow><Tooltip.ArrowTip /></Tooltip.Arrow>{tooltip}</Tooltip.Content></Tooltip.Positioner></Tooltip.Portal>
  </Tooltip.Root>
}

export { IconButton }
export type { IconButtonProps }
