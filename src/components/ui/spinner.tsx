import { LoaderCircle } from 'lucide-react'
import { forwardRef, type ComponentProps } from 'react'
import { cx } from '../../../styled-system/css'
import { spinner } from '../../../styled-system/recipes'

type SpinnerProps = ComponentProps<typeof LoaderCircle>

const Spinner = forwardRef<SVGSVGElement, SpinnerProps>(function Spinner({
  'aria-hidden': ariaHidden,
  'aria-label': ariaLabel,
  className,
  size = 16,
  ...props
}, ref) {
  return <LoaderCircle
    aria-hidden={ariaHidden ?? (ariaLabel ? undefined : true)}
    aria-label={ariaLabel}
    className={cx(spinner(), className)}
    data-part="root"
    data-scope="spinner"
    data-slot="spinner"
    ref={ref}
    size={size}
    {...props}
  />
})

export { Spinner }
export type { SpinnerProps }
