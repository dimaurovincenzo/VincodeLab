import { css } from '../../../styled-system/css'

const root = css({
  alignItems: 'start',
  bg: 'surfaceRaised',
  borderColor: 'borderDefault',
  borderRadius: 'l2',
  borderWidth: '1px',
  color: 'textPrimary',
  display: 'grid',
  gap: '3',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  outline: 'none',
  p: '4',
  w: 'full',
  _focusVisible: { boxShadow: '0 0 0 3px token(colors.focusRing)' },
})

export const errorNoticeStyles = {
  root,
  bootstrapBannerGroup: css({
    display: 'grid',
    gap: '2',
    left: '3',
    maxH: 'calc(100dvh - token(sizes.toolbar) - token(spacing.6))',
    maxW: '160',
    mx: 'auto',
    overflowY: 'auto',
    position: 'fixed',
    right: '3',
    top: '16',
    zIndex: 'popover',
    '& > *': { boxShadow: 'overlay' },
  }),
  severity: {
    info: css({ bg: 'stateInfoSoft', borderColor: 'stateInfo' }),
    warning: css({ bg: 'stateWarningSoft', borderColor: 'stateWarning' }),
    error: css({ bg: 'stateErrorSoft', borderColor: 'stateError' }),
  },
  icon: css({ display: 'grid', h: '5', placeItems: 'center', w: '5' }),
  iconTone: {
    info: css({ color: 'stateInfo' }),
    warning: css({ color: 'stateWarning' }),
    error: css({ color: 'stateError' }),
  },
  body: css({ display: 'grid', gap: '2', minW: '0' }),
  title: css({ color: 'textPrimary', fontSize: 'graphiteBody', fontWeight: 'graphiteSemibold', lineHeight: 'graphiteBody', m: '0' }),
  description: css({ color: 'textSecondary', fontSize: 'graphiteBody', lineHeight: 'graphiteBody', m: '0' }),
  reference: css({ color: 'textTertiary', fontFamily: 'mono', fontSize: 'graphiteMeta', m: '0' }),
  actions: css({ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '2', pt: '1' }),
  details: css({ borderTopColor: 'borderDefault', borderTopWidth: '1px', display: 'grid', gap: '2', mt: '1', pt: '3' }),
  detailsText: css({ color: 'textSecondary', fontFamily: 'mono', fontSize: 'graphiteMeta', lineHeight: 'graphiteBody', m: '0', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }),
  copyStatus: css({ color: 'textSecondary', fontSize: 'graphiteMeta', m: '0' }),
}
