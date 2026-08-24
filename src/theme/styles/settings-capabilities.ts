import { css } from '../../../styled-system/css'

const phone = '@media (max-width: 640px)'

export const settingsCapabilityStyles = {
  capabilityGroups: css({
    display: 'grid',
    gap: '6',
    mt: '5',
  }),
  capabilityGroup: css({ minW: '0' }),
  capabilityList: css({
    borderBottomColor: 'borderDefault',
    borderBottomWidth: '1px',
    listStyle: 'none',
    m: '3 0 0',
    p: '0',
  }),
  capabilityItem: css({
    alignItems: 'center',
    borderTopColor: 'borderDefault',
    borderTopWidth: '1px',
    display: 'grid',
    gap: '3',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    minH: '14',
    px: '1',
    py: '2.5',
    [phone]: { alignItems: 'flex-start', gridTemplateColumns: 'auto minmax(0, 1fr)', '& > :last-child': { gridColumn: '2' } },
  }),
  capabilityCopy: css({ display: 'grid', gap: '0.5', minW: '0' }),
  capabilityTitle: css({ color: 'textPrimary', fontSize: 'graphiteBody', fontWeight: 'graphiteSemibold' }),
  capabilityDetail: css({ color: 'textSecondary', fontSize: 'graphiteMeta', lineHeight: 'graphiteBody' }),
  capabilityState: css({
    borderRadius: 'full',
    fontSize: '2xs',
    fontWeight: 'graphiteBold',
    letterSpacing: '0.04em',
    px: '2',
    py: '1',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  }),
  capabilityStateReady: css({ color: 'stateSuccess' }),
  capabilityStateMissing: css({ color: 'stateWarning' }),
  capabilityStateBroken: css({ color: 'stateError' }),
  capabilityBadgeReady: css({ bg: 'stateSuccessSoft', color: 'stateSuccess' }),
  capabilityBadgeMissing: css({ bg: 'stateWarningSoft', color: 'stateWarning' }),
  capabilityBadgeBroken: css({ bg: 'stateErrorSoft', color: 'stateError' }),
}
