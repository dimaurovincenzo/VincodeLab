import { css } from '../../../styled-system/css'

export const emptyStateStyles = {
  root: css({
    alignContent: 'center',
    bg: 'surfaceCanvas',
    color: 'textSecondary',
    display: 'grid',
    flex: '1',
    justifyItems: 'center',
    minH: '0',
    minW: '0',
    p: '6',
    textAlign: 'center',
  }),
  icon: css({
    color: 'textTertiary',
    display: 'grid',
    h: '8',
    placeItems: 'center',
    w: '8',
    '& svg': { h: '6', w: '6' },
  }),
  eyebrow: css({
    color: 'textTertiary',
    fontSize: 'graphiteMeta',
    fontWeight: 'graphiteSemibold',
    letterSpacing: '0.05em',
    mb: '0',
    mt: '2.5',
    textTransform: 'uppercase',
  }),
  title: css({
    color: 'textPrimary',
    fontSize: 'graphiteSection',
    fontWeight: 'graphiteSemibold',
    mb: '1.5',
    mt: '1',
  }),
  description: css({
    color: 'textSecondary',
    fontSize: 'graphiteBody',
    lineHeight: 'graphiteBody',
    m: '0',
    maxW: '96',
  }),
}
