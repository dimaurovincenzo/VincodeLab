import { defineGlobalStyles } from '@pandacss/dev'

export const graphiteGlobalCss = defineGlobalStyles({
  ':root': {
    fontFamily: 'sans',
    fontSynthesis: 'none',
    textRendering: 'optimizeLegibility',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
  },
  'html, body, #root': {
    height: '100%',
    minHeight: '100%',
    overflow: 'hidden',
  },
  html: { fontFamily: 'sans' },
  body: {
    bg: 'surfaceCanvas',
    color: 'textPrimary',
    fontFamily: 'sans',
    minHeight: '100vh',
    minWidth: '320px',
    textRendering: 'optimizeLegibility',
  },
  '*': { borderColor: 'borderDefault' },
  ':where(a, [tabindex]:not([tabindex="-1"])):focus-visible': {
    outline: '2px solid token(colors.focus)',
    outlineOffset: '2px',
  },
  '::selection': { bg: 'selection', color: 'textPrimary' },
  '*, *::before, *::after': {
    _motionReduce: {
      animationDuration: '0.01ms !important',
      animationIterationCount: '1 !important',
      scrollBehavior: 'auto !important',
      transitionDuration: '0.01ms !important',
    },
  },
})
