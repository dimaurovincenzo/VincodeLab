import { ark } from '@ark-ui/react/factory'
import type { ComponentProps } from 'react'
import { styled } from '../../../styled-system/jsx'
import { button } from '../../../styled-system/recipes'

const ParkButton = styled(ark.button, button)

type ParkVariant = 'solid' | 'subtle' | 'surface' | 'outline' | 'plain'
type ParkTone = 'accent' | 'danger'
type ButtonProps = Omit<ComponentProps<typeof ParkButton>, 'tone' | 'variant'> & { tone?: ParkTone; variant?: ParkVariant }

function Button({ tone = 'accent', variant = 'solid', type = 'button', ...props }: ButtonProps) {
  return <ParkButton data-slot="button" tone={tone} type={type} variant={variant} {...props} />
}

export { Button }
export type { ButtonProps }
