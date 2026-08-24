import { css } from '../../../styled-system/css'

export const terminalDiagnosticsStyles = {
  diagnostics: css({
    borderTopColor: 'borderDefault',
    borderTopWidth: '1px',
    display: 'grid',
    gap: '3',
    mt: '5.5',
    pt: '4',
  }),
  diagnosticsHeader: css({ alignItems: 'center', display: 'flex', gap: '2', justifyContent: 'space-between' }),
  diagnosticsTitle: css({
    alignItems: 'center',
    display: 'flex',
    gap: '2',
    '& > svg': { color: 'accentText' },
    '& h3': { fontSize: 'sm', m: '0' },
    '& span': { color: 'textSecondary', fontSize: 'xs' },
  }),
  diagnosticsDescription: css({ color: 'textSecondary', fontSize: 'xs', m: '0' }),
  diagnosticsGrid: css({
    borderLeftColor: 'borderDefault',
    borderLeftWidth: '1px',
    borderTopColor: 'borderDefault',
    borderTopWidth: '1px',
    display: 'grid',
    gap: '0',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    m: '0',
    '@media (max-width: 760px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  }),
  diagnosticsMetric: css({ borderBottomColor: 'borderDefault', borderBottomWidth: '1px', borderRightColor: 'borderDefault', borderRightWidth: '1px', minW: '0', p: '2.5' }),
  diagnosticsTerm: css({ color: 'textSecondary', fontSize: 'xs' }),
  diagnosticsValue: css({
    color: 'textPrimary',
    fontFamily: 'mono',
    fontSize: 'sm',
    m: '1 0 0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  diagnosticsAction: css({ justifySelf: 'start' }),
}
